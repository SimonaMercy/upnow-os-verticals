'use client';
/**
 * Rental Provider — Overview (rental-provider/dashboard)
 *
 * Rebuilt to the Genspark Stage 2 "UpNow OS" Overview: greeting PageHead →
 * ScopeStrip → Attention → KPI rows → two-column cards → tables → live manager
 * activity. Composed from `@/components/os/kit`; nothing here restyles the kit.
 *
 * Parity with previous page ("Portfolio Overview", 2,518 lines):
 *
 *  API calls (unchanged endpoints, params and payload handling)
 *   [x] GET /api/properties/dashboard-stats?from&to        (manager: /api/manager/dashboard-stats?rp=&from&to)
 *   [x] GET /api/contracts/financial-summary?from&to       (manager: /api/manager/financial-summary?rp=…)
 *   [x] GET /api/contracts/dashboard-extras?from&to&window (manager: /api/manager/dashboard-extras?rp=…)
 *   [x] GET /api/reports/manager-activity?days=1&perDay=20 (manager: /api/manager/manager-activity?rp=…),
 *       polled every 5s, paused while the tab is hidden, last good rows kept on a failed poll
 *   [x] GET /api/fee-rules/configured (RP only) → fee-rules setup nudge, dismissible
 *   [x] legalApi.alerts('/legal' | '/manager/legal', rp) → Breach & legal card (hidden when nothing open)
 *   [x] All fetches abortable; range / renewal-window changes re-fire the range-scoped three
 *  New (read-only, best-effort — a failure hides only its own card):
 *   [+] GET /api/leads (manager: /api/manager/leads?rp=) → leads needing action, open leads,
 *       new leads 30d, "Where your leads come from", "Today" viewings timeline
 *   [+] GET /api/profiles/rental-provider/me (RP only) → ScopeStrip business name + verification
 *
 *  Figures, links and interactions
 *   [x] Properties → portfolio · Units → units · Customers → tenants · Active leases → orders ·
 *       Managers → settings?tab=team (no link in manager portal). All open in a new tab, as before.
 *       Tiles read "…" until stats arrive.
 *   [x] Rent vs Market (contracted of market, ±gap %, arrow + colour) → rent-vs-market report (new tab)
 *   [x] Deposits held + "across N leases" → security-deposits report
 *   [x] Arrears: Overdue / Bounced (with part-paid count) / Bounce fees (only when the API sends them),
 *       each with its eye affordance opening its own drill-down (headline, split, note, rows → contractHref)
 *   [x] Receivables card + period select + cheque drill + Cash Management link — kept behind
 *       SHOW_RECEIVABLES=false exactly as before (SCRUM-737)
 *   [x] Occupancy rate donut, "N of M units let · N start later", Occupied / Vacant openers
 *       (occupied: soonest-ending first with lapsed/soon/incoming notes; vacant: vacancy bars,
 *       foregone income, published vs not listed)
 *   [x] Upcoming renewals: 30/60/90/180/365-day selector, bucket partition (Agreed / Notice Sent /
 *       Notice due / Declined-when-present), each bucket drill grouped by renewal month, stacked
 *       distribution, "View all N renewals" → Operations renewal tab; error → retry
 *   [x] Breach & legal: Open breaches / Open cases tiles → list of records with stage + date,
 *       breach → operations/{lease}#sec-breaches, case → legal/{id}; "Legal" link
 *   [x] Manager activity (Live): one column per manager, day heading with action/page counts,
 *       trimmed-day note, collapsed runs (×N, time range), category tag, "Open" → lease / lead
 *       (new tab), row click → what-changed dialog; "Team page" link (RP only); empty/error states
 *   [x] Refresh (all range-scoped fetches + fee rules), error banner naming what failed + Retry
 *   [x] Every drill row opens in a new tab with rel=noopener (NEW_TAB)
 *   [x] Manager variant: `RpDashboardHome({ manager: { rp } })` export kept with the same props and
 *       ?rp= routing. (Nothing imports it today — /dashboard/manager/page.tsx is its own page — but
 *       /prototype/os/rp re-exports this default.)
 *
 *  Today queue (research report "Marketplace provider OS best practices", Overview row of the
 *  workspace blueprint + '"Today" screens'): the attention row is REPLACED by one queue ranked
 *  by consequence (./_today.tsx). Every attention card it had is still an item, same figure and
 *  same destination: leads needing follow-up → Leads · overdue / bounced cheques / bounce fees
 *  → Receivables · renewal notices due / declined / lapsed terms → Operations renewal tab ·
 *  open breaches / legal cases → Legal. The "nothing needs attention" callout is its empty state.
 *  Items, worst first, each with ONE labelled action to the real page:
 *   [+] 1 Gate 1 not compliant — /profiles/rental-provider/me profile.complianceStatus
 *       (+ complianceNotes, compliancePausedAt) → Documents / Profile. Landlord portal only.
 *   [+] 1 KYC documents expired / rejected / expiring ≤60·30·7 days — same GET, checklist[]
 *       uploaded + status + expiryDate (what KycDocumentsPanel renders) → Documents.
 *   [+] 2 Leads on the 15-min first-reply clock — GET /leads, rule in lib/os/sla.ts (stage 'new', or
 *       an untouched marketplace 'portal' lead; clock from createdAt), live 30s countdown → lead.
 *   [+] 3 Ejari not registered — NEW GET /contracts (manager: /manager/contracts?rp=):
 *       status active|issued (issued only within 14 days of start) and ejariStatus ≠ registered.
 *   [+] 3 90-day renewal notice (Law 33/2008 Art. 14) — NEW GET dashboard-extras window=180
 *       (fixed horizon, independent of the card's selector): bucket noticeDue with
 *       daysUntilEnd − 90 ≤ 30 days, "N days left · by <date>" or "window closed N days ago".
 *   [+] 3 Cheques due in the next 7 days — NEW GET financial-summary from=today&to=today+7,
 *       receivableCheques state 'due'. Overdue / bounced use the existing arrearsCheques.
 *   [+] 4 Listings rejected / changes requested — dashboard-stats units[].listingStatus → Units.
 *   [+] 6 Today's viewings (GET /leads viewings) and move-ins (units[].startsOn = today).
 *   Max 8 shown, "Show all N". Sources that failed are named above the list with Retry.
 *  [+] KPI "Leads waiting > 15 min" (row 1). "Response within 15 min (30 days)" is NOT shown: the
 *      leads API has no first-response timestamp, so the rate cannot be computed honestly.
 *  [~] The old "Today" viewings card is kept unchanged, retitled "Viewings today".
 *  [+] Head summary also says how many leads need a first response.
 *
 *  Layout changes: the custom dialogs (drill-downs, legal list, what-changed) are now the kit's
 *  Drawer / Modal; tiles are kit KPIs; the vacancy bars are a kit table. No capability was dropped.
 *  Removed nothing user-visible except the unused KpiMini helper (it rendered nowhere).
 */
import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight, Ban, Banknote, CalendarClock, CalendarDays, DoorOpen, Eye, FileWarning, Gavel, ListX, MessageSquareReply,
  RefreshCw, ShieldAlert, Stamp, TrendingDown, TrendingUp, UserRoundSearch, X,
} from 'lucide-react';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { legalApi, type AlertItem, type OpenRecord } from '@/lib/legal';
import { contractHref, surfaceOfLockedAt, type ContractSurface } from '@/lib/contractHref';
import { unitHref } from '@/lib/unitHref';
import { FIRST_RESPONSE_SLA_LABEL, FIRST_RESPONSE_SLA_MS, firstResponseSla, fmtSlaDuration } from '@/lib/os/sla';
import { leadDisplayName, type ApiLead } from '@/lib/leadJourney';
import { TodayQueue, type TodayItem } from './_today';
import {
  OsPage, PageHead, ScopeStrip, Card, Cols, Kpis, Pill, StatusTag, Btn, TableWrap,
  Callout, KV, Bars, Timeline, Drawer, Modal, EmptyRow, SkeletonRows, humanize, type Tone,
} from '@/components/os/kit';
import { cn } from '@/lib/utils';

interface DashboardStats {
  totalProperties: number;
  totalUnits: number;
  occupied: number;
  available: number;
  maintenance: number;
  reserved: number;
  occupancyRate: number;
  /** Of `occupied`: units on a confirmed lease that has not started yet — leased, nobody in yet. */
  leasedAhead?: number;
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
  /** Still owed — the face value less anything that has come in against it. */
  amount: number;
  /** The cheque's own value; differs from `amount` only on a part-paid bounce.
   *  Optional so an older payload still renders. */
  faceAmount?: number;
  dueDate: string | null;
  chequeNumber: string | null;
  kind: 'overdue' | 'bounced';
  customer: string | null;
  unitLabel: string | null;
  buildingName: string | null;
  /** >0 only on a bounce PART made good — the remainder is still owed. */
  coveredAmount: number;
  /** The balance of that bounce keyed with no date — why it is still listed. */
  undatedBalance?: number;
  /** `locked_at IS NOT NULL` on the cheque's lease — which of the two contract
   *  surfaces the row opens. Server-decided; the client cannot see `locked_at`.
   *  Optional so an older payload falls back to the register rather than 404ing. */
  locked?: boolean;
}

/** A bounced-cheque fee not yet paid — the rows behind the Bounce fees tile. */
interface BounceFee {
  id: number;
  contractId: number;
  amount: number;
  date: string | null;
  /** The bounced cheque's number when the fee is linked to it; older fee rows
   *  name it only in `description`. */
  forCheque: string | null;
  description: string | null;
  customer: string | null;
  unitLabel: string | null;
  buildingName: string | null;
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
  /** Bounced-cheque fees the customer has not paid. Optional: an older backend
   *  does not send them, and the tile then stays hidden rather than reading 0. */
  bounceFeesCount?: number;
  bounceFeesAmount?: number;
  bounceFees?: BounceFee[];
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
  // "Agreed": the customer accepted or signed and the cheques are still to be
  // collected. A renewal whose cheques are collected is done and is not listed at
  // all (owner, 15 Sep 2026). "Notice Sent" pairs with "Notice due" so the two
  // halves of the same step read as one, and matches the Operations board's lane.
  { key: 'renewed',    label: 'Agreed',      hint: 'accepted — cheques to collect', tone: 'green' },
  { key: 'noticeSent', label: 'Notice Sent', hint: 'awaiting the customer',        tone: 'indigo' },
  { key: 'noticeDue',  label: 'Notice due',  hint: 'nobody asked yet — your move', tone: 'amber' },
  // No "New customer" tile: a new customer's first lease is not a renewal, so it is
  // listed when its own renewal falls due (owner, 15 Sep 2026).
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
function vacancyFill(days: number): '' | 'amber' | 'danger' {
  return days >= 90 ? 'danger' : days >= 30 ? 'amber' : '';
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

/** Drill badge tone → kit pill tone. */
const PILL_TONE: Record<BadgeTone, Tone> = {
  green: 'primary', amber: 'amber', red: 'danger', indigo: 'info', gray: 'neutral',
};

/** A link that leaves the page in a new tab, styled as a kit button. Kept local
 *  because the kit's Btn cannot carry `rel` with `target`. */
function OpenLink({ href, children = 'Open', newTab = true }: { href: string; children?: ReactNode; newTab?: boolean }) {
  return (
    <Link href={href} className="gx-btn xs" {...(newTab ? NEW_TAB : {})}>
      {children}{newTab && <ArrowUpRight size={11} aria-hidden />}
    </Link>
  );
}

/** "How long they've been empty" — the vacant units as a duration measure.
 *  One series (days empty) scaled to the longest and sorted worst-first; the
 *  duration, the date it went empty and the money it has cost sit on the row.
 *  Bar tint is neutral / amber / red (never the primary green, which is
 *  "Occupied" on the donut) and the duration is always written beside it. */
function VacancyTable({ units, totals, manager, limit, onShowAll }: {
  units: UnitRow[];
  totals?: VacancyTotals;
  manager?: { rp: number };
  limit?: number;
  onShowAll?: () => void;
}) {
  const longest = totals?.longestDaysVacant || Math.max(1, ...units.map(u => u.daysVacant ?? 0));
  const rows = limit ? units.slice(0, limit) : units;
  return (
    <>
      <table className="gx-tbl">
        <thead>
          <tr><th>Unit</th><th>Empty for</th><th>Listing</th><th className="num">Foregone</th><th className="act" aria-label="Actions" /></tr>
        </thead>
        {rows.length === 0 ? (
          <EmptyRow cols={5} title="No vacant units" text=" — every unit in the portfolio is let." />
        ) : (
          <tbody>
            {rows.map(u => {
              const days = u.daysVacant ?? 0;
              const pct = Math.max(4, Math.round((days / longest) * 100));
              const tone = vacancyFill(days);
              const label = u.number ? `Unit ${u.number}` : (u.name ?? `Unit ${u.id}`);
              return (
                <tr key={u.id}>
                  <td className="strong">{label}<span className="sub">{u.building ?? '—'}</span></td>
                  <td style={{ minWidth: 150 }}>
                    <span className="nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDuration(days)}</span>
                    <span className={cn('gx-bar', tone)} style={{ display: 'block', marginTop: 4 }}>
                      <i style={{ width: `${pct}%`, ...(tone ? {} : { background: 'var(--ms-border-strong)' }) }} />
                    </span>
                    {/* Since-when; a unit never let says so. */}
                    <span className="sub">{u.basis === 'never-leased' ? 'never let' : `since ${u.vacantSince ? fmtDayMonthYear(u.vacantSince) : '—'}`}</span>
                  </td>
                  <td>
                    <Pill tone={u.listingStatus === 'published' ? 'primary' : 'amber'}>
                      {u.listingStatus === 'published' ? 'Published' : `Not listed · ${u.listingStatus}`}
                    </Pill>
                  </td>
                  {/* A unit with no rent on file is not a free vacancy — it says so rather than AED 0. */}
                  <td className="num">{u.rentBasis == null ? 'no rent set' : `−${fmtAed(u.lostIncome ?? 0)}`}</td>
                  <td className="act"><OpenLink href={unitHref(u.id, manager)} /></td>
                </tr>
              );
            })}
          </tbody>
        )}
      </table>
      {limit != null && units.length > limit && onShowAll && (
        <div className="gx-pad" style={{ borderTop: '1px solid var(--ms-surface-3)' }}>
          <Btn size="sm" onClick={onShowAll}>Show all {units.length} vacant units</Btn>
        </div>
      )}
    </>
  );
}

/* ─── Leads (read-only slice for the Overview) ─────────────────────────────── */

/** The fields of GET /leads this page reads. Same shape the Leads page uses. */
interface OvLead {
  id: number;
  stage: string;
  customerName: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  viewings?: Array<{ id: number; scheduledAt: string; status: string; createdAt?: string; updatedAt?: string }>;
  unit: { unitNumber: string; property?: { buildingName: string } } | null;
  /** Read only to name the lead the way the Leads page does (company wins). */
  convertedTenant?: ApiLead['convertedTenant'];
}
/** The lead's name as the Leads queue shows it (lib/leadJourney leadDisplayName). */
const ovLeadName = (l: OvLead) => leadDisplayName({ customerName: l.customerName, convertedTenant: l.convertedTenant ?? null });

/* ─── Today queue sources (read-only) ─────────────────────────────────────── */

/** GET /profiles/rental-provider/me — Gate 1 status + the KYC checklist the
 *  Documents page (KycDocumentsPanel) renders, with each document's expiry. */
interface OvProfile {
  companyName?: string | null;
  complianceStatus?: string | null;
  compliancePausedAt?: string | null;
  complianceNotes?: string | null;
}
interface OvKycDoc {
  key: string;
  displayName: string;
  required: boolean;
  uploaded: boolean;
  status: string | null;
  expiryDate: string | null;
}
/** GET /contracts (manager: /manager/contracts?rp=) — the fields the Ejari check reads. */
interface OvContract {
  id: number;
  status: string;
  ejariStatus: string | null;
  contractType: string | null;
  startDate: string;
  endDate: string;
  lockedAt: string | null;
  tenant: { name: string | null; companyName?: string | null; entityType?: string | null } | null;
  unit: { number: string | null } | null;
  property: { buildingName: string | null } | null;
}

/** Days from Dubai day `from` to Dubai day `to` (both 'YYYY-MM-DD'), signed. */
function ymdDiff(from: string, to: string): number {
  const p = (x: string) => { const [y, m, d] = x.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(to) - p(from)) / OV_DAY_MS);
}
/** 'YYYY-MM-DD' ± n days, calendar arithmetic (no zone drift). */
function ymdAdd(ymd: string, n: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const fmtShortDay = (ymd: string) =>
  new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const daysWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
/** Art. 14, Law 33/2008: a party changing terms at renewal must notify 90 days before expiry. */
const RENEWAL_NOTICE_DAYS = 90;

const OV_DAY_MS = 86_400_000;

/** The pending viewing the Leads page triages on (same rule as its getPendingViewing). */
function pendingViewing(lead: OvLead) {
  return lead.viewings
    ?.filter(v => v.status === 'scheduled' || v.status === 'confirmed')
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0] ?? null;
}

/** True when the Leads page would flag this lead as needing action — the same
 *  thresholds as its getUrgency(): a viewing whose date passed without an
 *  outcome, or a stage left idle past its follow-up window. */
function leadNeedsAction(lead: OvLead, now: number): boolean {
  if (lead.stage === 'viewing_scheduled') {
    const v = pendingViewing(lead);
    return !!v && new Date(v.scheduledAt).getTime() < now;
  }
  const idle = Math.floor((now - new Date(lead.updatedAt).getTime()) / OV_DAY_MS);
  switch (lead.stage) {
    case 'payment_plan_shared':
    case 'documents_collection':
    case 'interested':
      return idle >= 3;
    case 'cheques_submitted':
      return idle >= 2;
    default:
      return false;
  }
}

/** Dubai calendar day of an instant, 'YYYY-MM-DD'. */
const dubaiDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });

/** Activity category → kit pill tone (the same grouping the old tints used). */
const CATEGORY_TONE: Record<string, Tone> = {
  Leads: 'info', Customers: 'info', Signature: 'info',
  Termination: 'danger', Settlement: 'danger',
  Payments: 'amber', Registration: 'amber',
  Properties: 'primary', Units: 'primary', Listings: 'primary',
  Contracts: 'primary', Inspection: 'primary', Renewal: 'primary',
  Documents: 'neutral', Viewing: 'neutral', Session: 'neutral',
  Team: 'outline', Templates: 'outline', AMC: 'outline', Settings: 'outline',
};
const categoryTone = (c: string): Tone => CATEGORY_TONE[c] ?? 'neutral';

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
  // Legal & breach alerts (spec §8) — deadlines passed, hearings due, notices to
  // send. One fetch on load; the card hides itself when there is nothing open.
  const [legal, setLegal] = useState<{ items: AlertItem[]; counts: { breaches: number; disputes: number }; open?: { breaches: OpenRecord[]; cases: OpenRecord[] } } | null>(null);
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
  }, [manager]);

  // Re-fire range-scoped fetches whenever the user picks a different range.
  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the awaited response, never synchronously
    fetchStats(selectedRange, ac.signal);
    fetchFinancial(selectedRange, ac.signal);
    fetchExtras(selectedRange, renewalWindow, ac.signal);
    return () => ac.abort();
  }, [selectedRange, renewalWindow, fetchStats, fetchFinancial, fetchExtras]);

  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the awaited response, never synchronously
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the awaited response, never synchronously
    void fetchFeed(ac.signal);
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      ac.abort();
    };
  }, [fetchFeed]);

  useEffect(() => {
    let cancelled = false;
    legalApi.alerts(manager ? '/manager/legal' : '/legal', manager?.rp)
      .then(d => { if (!cancelled && d && Array.isArray(d.items)) setLegal(d); })
      .catch(() => { /* the card simply does not render */ });
    return () => { cancelled = true; };
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

  // ── Genspark Overview additions (read-only, best-effort) ──────────────────
  // Leads feed the attention row, the lead-source bars and today's viewings.
  // The Leads page is the record of truth; this only counts what it shows.
  const leadsUrl = manager ? `/manager/leads?rp=${manager.rp}` : '/leads';
  const leadHref = (id: number) => (manager ? `${leadsBase}/${id}?rp=${manager.rp}` : `${leadsBase}/${id}`);
  const [leads, setLeads] = useState<OvLead[] | null>(null);
  const [leadsErr, setLeadsErr] = useState<string | null>(null);
  const fetchLeads = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await apiGet<OvLead[]>(leadsUrl, { signal });
      setLeads(Array.isArray(data) ? data : []);
      setLeadsErr(null);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setLeadsErr((e as Error).message || 'Failed to load leads');
    }
  }, [leadsUrl]);
  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the awaited response, never synchronously
    void fetchLeads(ac.signal);
    return () => ac.abort();
  }, [fetchLeads]);

  // Business name + Gate 1 status for the scope strip — landlord portal only;
  // a manager reads this landlord's book, not their own business profile.
  // The same GET also feeds Today's gate blockers (Gate 1 status, KYC expiry).
  const [profile, setProfile] = useState<OvProfile | null>(null);
  const [kycDocs, setKycDocs] = useState<OvKycDoc[] | null>(null);
  const [profileErr, setProfileErr] = useState(false);
  const fetchProfile = useCallback(async (signal?: AbortSignal) => {
    if (manager) return;
    try {
      const d = await apiGet<{ profile: OvProfile; checklist?: OvKycDoc[] }>('/profiles/rental-provider/me', { signal });
      if (d?.profile) setProfile(d.profile);
      setKycDocs(Array.isArray(d?.checklist) ? d.checklist : []);
      setProfileErr(false);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setProfileErr(true); // the strip falls back to the signed-in name
    }
  }, [manager]);
  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the awaited response, never synchronously
    void fetchProfile(ac.signal);
    return () => ac.abort();
  }, [fetchProfile]);

  // ── Today queue: the three extra reads it needs (best-effort, read-only) ──
  //  · leases → Ejari registration still pending
  //  · renewals over a fixed 180-day horizon → the 90-day notice clock, so the
  //    queue does not change when the Upcoming renewals card's selector does
  //  · cheques falling due in the next 7 Dubai days
  const [todayContracts, setTodayContracts] = useState<OvContract[] | null>(null);
  const [todayRenewals, setTodayRenewals] = useState<UpcomingRenewal[] | null>(null);
  const [dueSoon, setDueSoon] = useState<ReceivableCheque[] | null>(null);
  const [todayErr, setTodayErr] = useState<{ leases?: boolean; renewals?: boolean; cheques?: boolean }>({});
  const fetchToday = useCallback(async (signal?: AbortSignal) => {
    const t0 = dubaiDay(new Date());
    const month = presetToDates('this_month');
    const [c, r, f] = await Promise.allSettled([
      apiGet<OvContract[]>(manager ? `/manager/contracts?rp=${manager.rp}` : '/contracts', { signal }),
      apiGet<DashboardExtras>(`/${manager ? 'manager/dashboard-extras' : 'contracts/dashboard-extras'}?${rpQ}from=${month.from}&to=${month.to}&window=180`, { signal }),
      apiGet<FinancialSummary>(`/${manager ? 'manager/financial-summary' : 'contracts/financial-summary'}?${rpQ}from=${t0}&to=${ymdAdd(t0, 7)}`, { signal }),
    ]);
    if (signal?.aborted) return;
    if (c.status === 'fulfilled' && Array.isArray(c.value)) setTodayContracts(c.value);
    if (r.status === 'fulfilled' && Array.isArray(r.value?.upcomingRenewals)) setTodayRenewals(r.value.upcomingRenewals);
    if (f.status === 'fulfilled' && Array.isArray(f.value?.receivableCheques)) setDueSoon(f.value.receivableCheques);
    setTodayErr({
      leases: !(c.status === 'fulfilled' && Array.isArray(c.value)),
      renewals: !(r.status === 'fulfilled' && Array.isArray(r.value?.upcomingRenewals)),
      cheques: !(f.status === 'fulfilled' && Array.isArray(f.value?.receivableCheques)),
    });
  }, [manager, rpQ]);
  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the awaited response, never synchronously
    void fetchToday(ac.signal);
    return () => ac.abort();
  }, [fetchToday]);

  // First-reply countdowns re-read every 30s — arithmetic on createdAt, no refetch.
  const [tickMs, setTickMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTickMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // "Now" is read once per mount (and on Refresh) — never in render.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const today = dubaiDay(new Date(nowMs));
  const leadStats = useMemo(() => {
    if (!leads) return null;
    const open = leads.filter(l => l.stage !== 'converted' && l.stage !== 'rejected');
    const needAction = open.filter(l => leadNeedsAction(l, nowMs)).length;
    const new30 = leads.filter(l => nowMs - new Date(l.createdAt).getTime() <= 30 * OV_DAY_MS).length;
    const bySource = new Map<string, number>();
    for (const l of leads) {
      const k = l.source ? humanize(l.source) : 'Not recorded';
      bySource.set(k, (bySource.get(k) ?? 0) + 1);
    }
    const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
    const viewingsToday = leads
      .flatMap(l => (l.viewings ?? []).map(v => ({ lead: l, v })))
      .filter(({ v }) => v.status !== 'cancelled' && dubaiDay(new Date(v.scheduledAt)) === today)
      .sort((a, b) => a.v.scheduledAt.localeCompare(b.v.scheduledAt));
    return { open: open.length, needAction, new30, sources, total: leads.length, viewingsToday };
  }, [leads, nowMs, today]);
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
      panel: <VacancyTable units={vacantUnits} totals={vacancyTotals} manager={manager} />,
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
        : 'Cheques the bank refused that are still to chase. A cheque paid in part is listed for the balance still owed. Two kinds are excluded: one paid in full (its replacement is counted instead) and one already carried by a final settlement, where the landlord has proposed how it resolves.',
      groups: [{
        rows: rows.map(c => {
          const late = daysLate(c.dueDate);
          return {
            key: c.id,
            title: c.customer ?? 'Customer',
            subtitle: `${c.unitLabel ? `${c.unitLabel} · ` : ''}${c.buildingName ?? ''} · due ${day(c.dueDate)}`
              + `${c.chequeNumber ? ` · #${c.chequeNumber}` : ''}`
              + `${late ? ` · ${late} day${late === 1 ? '' : 's'} late` : ''}`
              // A part-paid bounce: say what came back against the cheque, so the
              // amount on the right reads as the balance and not a smaller cheque.
              + `${c.coveredAmount > 0 ? ` · ${c.coveredAmount.toLocaleString()} of ${(c.faceAmount ?? c.coveredAmount + c.amount).toLocaleString()} recovered` : ''}`
              // …and when the balance was keyed with no date, say so: that is the
              // one thing the team has to fix for it to be chased on its date.
              + `${(c.undatedBalance ?? 0) > 0 ? ' · balance undated' : ''}`,
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
  const bouncedPartPaid = fin?.arrearsCheques.filter(c => c.kind === 'bounced' && c.coveredAmount > 0).length ?? 0;

  /** The fees behind the Bounce fees tile — the penalty raised on each bounce,
   *  which the rent-only Bounced tile never shows. */
  const drillBounceFees = () => {
    if (!fin?.bounceFees) return;
    const rows = fin.bounceFees;
    const fmt = (n: number) => `AED ${n.toLocaleString()}`;
    const day = (iso: string | null) => iso
      ? new Date(iso).toLocaleDateString(undefined, { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: '2-digit' })
      : null;
    const total = rows.reduce((n, f) => n + f.amount, 0);
    setDrill({
      title: 'Bounce fees',
      headline: fmt(total),
      summary: [
        { label: 'Fees', value: String(rows.length) },
        { label: 'Leases', value: String(new Set(rows.map(f => f.contractId)).size) },
        { label: 'Total', value: fmt(total), tone: 'red' },
      ],
      note: 'Bounced-cheque fees charged to the customer and not yet paid. A lease already on a final settlement is excluded — the settlement charges the fee for each bounce it carries.',
      groups: [{
        rows: rows.map(f => ({
          key: f.id,
          title: f.customer ?? 'Customer',
          subtitle: `${f.unitLabel ? `${f.unitLabel} · ` : ''}${f.buildingName ?? ''}`
            + (f.forCheque ? ` · for cheque #${f.forCheque}` : (f.description ? ` · ${f.description}` : ''))
            + (day(f.date) ? ` · raised ${day(f.date)}` : ''),
          amount: fmt(f.amount),
          href: contractHref(f.contractId, f.locked === false ? 'operations' : 'lease', manager),
        })),
      }],
    });
  };

  const rangeLabel = RANGE_PRESETS.find(r => r.key === selectedRange)?.label ?? '';


  const gaugePct = Math.min(100, Math.max(0, occupancyRate));
  const dashLen = 2 * Math.PI * 40;

  const refreshEverything = useCallback(async () => {
    setNowMs(Date.now());
    setTickMs(Date.now());
    await Promise.all([refreshAll(), fetchLeads(), fetchProfile(), fetchToday()]);
  }, [refreshAll, fetchLeads, fetchProfile, fetchToday]);

  // ── Head: greeting, Dubai date, one-line summary from real numbers ────────
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] || 'there';
  const dubaiHour = Number(new Date(nowMs).toLocaleString('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }));
  const greeting = dubaiHour < 12 ? 'Good morning' : dubaiHour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = new Date(nowMs).toLocaleDateString('en-GB', { timeZone: APP_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const renewalCounts = extras?.renewalBuckets ?? (extras ? renewalsList.reduce((acc, r) => {
    const k = r.bucket ?? 'noticeDue';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, { renewed: 0, noticeSent: 0, noticeDue: 0, newCustomer: 0, vacating: 0 } as Record<RenewalBucket, number>) : undefined);
  const noticeDue = renewalCounts?.noticeDue ?? 0;
  const declined = renewalCounts?.vacating ?? 0;
  const lapsedTerms = units.filter(u => u.availability === 'occupied' && !((u.daysToStart ?? 0) > 0) && (u.daysToEnd ?? 1) < 0).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const awaitingReplyCount = leads ? leads.filter(l => firstResponseSla(l, tickMs) !== null).length : 0;
  const summaryParts = [
    awaitingReplyCount > 0 ? `${plural(awaitingReplyCount, 'lead needs', 'leads need')} a first response` : null,
    leadStats && leadStats.needAction > 0 ? `${plural(leadStats.needAction, 'lead needs', 'leads need')} a follow-up` : null,
    fin && fin.overdueCount > 0 ? `${plural(fin.overdueCount, 'cheque is', 'cheques are')} overdue (${fmtAed(fin.overdueAmount)})` : null,
    fin && fin.bouncedCount > 0 ? `${plural(fin.bouncedCount, 'cheque has', 'cheques have')} bounced` : null,
    noticeDue > 0 ? `${plural(noticeDue, 'renewal notice is', 'renewal notices are')} due` : null,
  ].filter(Boolean) as string[];
  const dataReady = stats != null && fin != null && extras != null;
  const summary = summaryParts.length
    ? `${summaryParts.slice(0, -1).join(', ')}${summaryParts.length > 1 ? ' and ' : ''}${summaryParts[summaryParts.length - 1]}.`
    : dataReady ? 'Nothing is waiting on you right now.' : 'Loading your portfolio…';

  const reportsHref = manager ? `/dashboard/manager/reports?rp=${manager.rp}` : '/rental-provider/dashboard/reports';
  const createListingHref = manager ? `/dashboard/manager/units/add?rp=${manager.rp}` : '/rental-provider/dashboard/units/add';
  const receivablesHref = manager ? `/dashboard/manager/payments?rp=${manager.rp}` : '/rental-provider/dashboard/receivables';
  const legalBase = manager ? '/dashboard/manager/legal' : '/rental-provider/dashboard/legal';
  const legalHref = manager ? `${legalBase}?rp=${manager.rp}` : legalBase;
  const leadsHref = manager ? `${leadsBase}?rp=${manager.rp}` : leadsBase;

  const verification = manager ? null : profile?.complianceStatus === 'compliant'
    ? <Pill tone="primary">Verified</Pill>
    : profile?.complianceStatus ? <StatusTag status={profile.complianceStatus} /> : <span>—</span>;

  // ── Today: one queue ranked by consequence (research blueprint, Overview) ──
  // Every item comes from a real field; nothing is inferred beyond what is
  // written next to it. Bands: 1 gate blockers · 2 first-reply clock ·
  // 3 legal + money clocks · 4 listings · 5 lead follow-ups · 6 today's diary.
  const documentsHref = '/rental-provider/dashboard/documents';
  const profileHref = '/rental-provider/dashboard/profile';
  const unitsListingHref = (id: number) => unitHref(id, manager);
  const leadAwaitingReply = leads ? leads.filter(l => firstResponseSla(l, tickMs) !== null) : []; // same set as awaitingReplyCount
  const leadsWaitingOverSla = leadAwaitingReply.filter(l => tickMs - new Date(l.createdAt).getTime() > FIRST_RESPONSE_SLA_MS).length;
  const todayItems: TodayItem[] = [];
  const unitName = (n: string | null | undefined, b?: string | null) => [n ? `Unit ${n}` : null, b].filter(Boolean).join(' · ') || 'Unit';

  // 1 · Gate 1 — business verification not compliant (landlord portal only;
  //     a manager cannot act on the landlord's own verification).
  const gate = profile?.complianceStatus;
  if (!manager && gate && gate !== 'compliant') {
    const fix = gate === 'action_required' || gate === 'expired';
    todayItems.push({
      key: 'gate', band: 1, dueAt: 0, tone: gate === 'pending_review' ? 'warn' : 'bad', icon: ShieldAlert,
      title: `Business verification: ${humanize(gate)}`,
      consequence: profile?.complianceNotes?.trim()
        ? `Gate 1 — required to publish and stay live. UpNow: “${profile.complianceNotes.trim()}”`
        : gate === 'pending_review' ? 'Gate 1 — UpNow is reviewing your documents; listings go live once verified.'
          : 'Gate 1 — required to publish and stay live.',
      due: profile?.compliancePausedAt ? `Paused since ${fmtShortDay(dubaiDay(new Date(profile.compliancePausedAt)))}` : gate === 'pending_review' ? 'In review' : 'Now',
      action: fix ? { label: 'Fix documents', href: documentsHref } : { label: 'View verification', href: profileHref },
    });
  }
  // 1 · KYC documents — expired, rejected, or expiring within 60 / 30 / 7 days.
  if (!manager && kycDocs) {
    for (const d of kycDocs) {
      if (!d.uploaded) continue;
      const left = d.expiryDate ? ymdDiff(today, d.expiryDate) : null;
      const expired = d.status === 'expired' || (left != null && left < 0);
      const rejected = d.status === 'rejected';
      if (!expired && !rejected && (left == null || left > 60)) continue;
      const tone = expired || rejected || (left != null && left <= 7) ? 'bad' : left != null && left <= 30 ? 'warn' : 'info';
      todayItems.push({
        key: `kyc-${d.key}`, band: 1, tone, icon: FileWarning,
        title: `${d.displayName} ${rejected ? 'rejected' : expired ? 'expired' : 'expiring'}`,
        consequence: d.required ? 'Required for business verification (Gate 1) — keep a current copy on file.' : 'Optional document on your verification file — replace it or remove it.',
        due: rejected ? 'Upload a new copy'
          : left == null ? 'Expired'
          : left < 0 ? `Expired ${daysWord(-left)} ago`
          : left === 0 ? 'Expires today' : `${daysWord(left)} left · ${fmtShortDay(d.expiryDate as string)}`,
        dueAt: d.expiryDate ? new Date(d.expiryDate).getTime() : undefined,
        action: { label: rejected || expired ? 'Upload new copy' : 'Renew document', href: documentsHref },
      });
    }
  }

  // 2 · First-reply clock — 15 min from arrival (lib/os/sla), live countdown.
  for (const l of leadAwaitingReply) {
    const sla = firstResponseSla(l, tickMs);
    if (!sla) continue;
    todayItems.push({
      key: `sla-${l.id}`, band: 2, tone: sla.overdue ? 'bad' : sla.nearing ? 'warn' : 'info', icon: MessageSquareReply,
      title: `Reply to ${ovLeadName(l)}`,
      consequence: `${l.source ? humanize(l.source) : 'New'} enquiry${l.unit ? ` for ${unitName(l.unit.unitNumber, l.unit.property?.buildingName)}` : ''} · first reply due within ${FIRST_RESPONSE_SLA_LABEL} of arrival`,
      due: sla.overdue ? `Overdue ${fmtSlaDuration(sla.remainingMs)}` : `${fmtSlaDuration(sla.remainingMs)} left`,
      dueAt: sla.dueAt,
      action: { label: 'Reply', href: leadHref(l.id) },
    });
  }

  // 3 · Legal clocks — Ejari registration (Law 26/2007 Art. 4).
  if (todayContracts) {
    for (const c of todayContracts) {
      if (c.status !== 'active' && c.status !== 'issued') continue;
      if (c.ejariStatus === 'registered') continue;
      const toStart = ymdDiff(today, c.startDate);
      if (c.status === 'issued' && toStart > 14) continue; // not yet near its start
      const who = c.tenant?.entityType === 'company' && c.tenant.companyName ? c.tenant.companyName : (c.tenant?.name ?? 'Customer');
      todayItems.push({
        key: `ejari-${c.id}`, band: 3, tone: toStart <= 0 ? 'bad' : 'warn', icon: Stamp,
        title: `Register Ejari — ${unitName(c.unit?.number, c.property?.buildingName)} · ${who}`,
        consequence: `Every ${c.contractType === 'renewal' ? 'renewal' : 'lease'} must be registered (Law 26/2007 Art. 4); DEWA needs the Ejari.`,
        due: toStart < 0 ? `Started ${daysWord(-toStart)} ago` : toStart === 0 ? 'Starts today' : `Starts in ${daysWord(toStart)}`,
        dueAt: new Date(c.startDate).getTime(),
        action: { label: 'Open lease', href: contractHref(c.id, surfaceOfLockedAt(c.lockedAt), manager) },
      });
    }
  }
  // 3 · Legal clocks — 90-day renewal notice (Law 33/2008 Art. 14), leases
  //     whose notice deadline is within 30 days or already passed.
  const itemisedNotice = new Set<number>();
  for (const r of todayRenewals ?? []) {
    if ((r.bucket ?? 'noticeDue') !== 'noticeDue' || r.runningUnsigned) continue;
    const left = r.daysUntilEnd - RENEWAL_NOTICE_DAYS;
    if (left > 30) continue;
    itemisedNotice.add(r.contractId);
    todayItems.push({
      key: `notice-${r.contractId}`, band: 3, tone: left < 0 || left <= 7 ? 'bad' : 'warn', icon: CalendarClock,
      title: `Renewal notice — ${r.unitLabel}${r.tenantName ? ` · ${r.tenantName}` : ''}`,
      consequence: left >= 0
        ? `To change rent or terms, notify the customer at least 90 days before expiry (Law 33/2008 Art. 14). Lease ends ${fmtShortDay(r.endDate)}.`
        : `The 90-day notice window has passed (Art. 14) — new terms now need the customer’s agreement. Lease ends in ${daysWord(Math.max(0, r.daysUntilEnd))}.`,
      due: left > 0 ? `${daysWord(left)} left · by ${fmtShortDay(ymdAdd(r.endDate, -RENEWAL_NOTICE_DAYS))}` : left === 0 ? 'Notice due today' : `Window closed ${daysWord(-left)} ago`,
      dueAt: new Date(ymdAdd(r.endDate, -RENEWAL_NOTICE_DAYS)).getTime(),
      action: { label: 'Open renewal', href: contractHref(r.openContractId ?? r.contractId, r.openIn ?? 'lease', manager) },
    });
  }
  // The rest of the renewal work the old attention row counted (same figures).
  const noticeDueRest = (todayRenewals ? noticeDue - [...itemisedNotice].filter(id => renewalsList.some(x => x.contractId === id && (x.bucket ?? 'noticeDue') === 'noticeDue')).length : noticeDue);
  if (noticeDueRest > 0) todayItems.push({ key: 'notice-rest', band: 3, tone: 'info', icon: CalendarClock, title: `${plural(noticeDueRest, 'more renewal notice', 'more renewal notices')} to plan`, consequence: `Within the next ${renewalWindow} days — nobody asked yet, your move.`, due: `Next ${renewalWindow} days`, action: { label: 'Open renewals', href: renewalsPipelineHref } });
  if (declined > 0) todayItems.push({ key: 'declined', band: 3, tone: 'bad', icon: Ban, title: `${plural(declined, 'renewal', 'renewals')} declined`, consequence: 'The customer said no — start the termination so the move-out and deposit run on time.', due: 'Now', action: { label: 'Open renewals', href: renewalsPipelineHref } });
  if (lapsedTerms > 0) todayItems.push({ key: 'lapsed', band: 3, tone: 'bad', icon: CalendarClock, title: `${plural(lapsedTerms, 'term has', 'terms have')} lapsed, still occupied`, consequence: 'The unit is occupied past its lease end — the renewal is overdue.', due: 'Overdue', action: { label: 'Open renewals', href: renewalsPipelineHref } });
  if (legal && legal.counts.breaches > 0) todayItems.push({ key: 'breaches', band: 3, tone: 'warn', icon: Gavel, title: `${plural(legal.counts.breaches, 'open breach', 'open breaches')}`, consequence: 'Breach notices run on statutory deadlines — check what is due next.', due: 'Open', action: { label: 'Open legal', href: legalHref } });
  if (legal && legal.counts.disputes > 0) todayItems.push({ key: 'cases', band: 3, tone: 'warn', icon: Gavel, title: `${plural(legal.counts.disputes, 'open legal case', 'open legal cases')}`, consequence: 'Hearings and filings have dates — check what is due next.', due: 'Open', action: { label: 'Open legal', href: legalHref } });

  // 3 · Money clocks — bounced, overdue (whole book), bounce fees, due in 7 days.
  if (fin) {
    const oldest = (kind: 'bounced' | 'overdue') => fin.arrearsCheques.filter(a => a.kind === kind && a.dueDate).map(a => a.dueDate as string).sort()[0];
    if (fin.bouncedCount > 0) {
      const o = oldest('bounced');
      todayItems.push({ key: 'bounced', band: 3, tone: 'bad', icon: Banknote, title: `${plural(fin.bouncedCount, 'bounced cheque', 'bounced cheques')} · ${fmtAed(fin.bouncedAmount)}`, consequence: 'The bank refused them — collect a replacement and record it.', due: o ? `Since ${fmtShortDay(o)}` : 'Bounced', dueAt: o ? new Date(o).getTime() : undefined, action: { label: 'Open receivables', href: receivablesHref } });
    }
    if (fin.overdueCount > 0) {
      const o = oldest('overdue');
      todayItems.push({ key: 'overdue', band: 3, tone: 'bad', icon: Banknote, title: `${plural(fin.overdueCount, 'overdue cheque', 'overdue cheques')} · ${fmtAed(fin.overdueAmount)}`, consequence: 'Past their date and not marked collected — deposit or chase them.', due: o ? `Overdue ${daysWord(Math.max(0, ymdDiff(o, today)))}` : 'Overdue', dueAt: o ? new Date(o).getTime() : undefined, action: { label: 'Open receivables', href: receivablesHref } });
    }
    if (fin.bounceFees && (fin.bounceFeesCount ?? 0) > 0) todayItems.push({ key: 'fees', band: 3, tone: 'warn', icon: Banknote, title: `${plural(fin.bounceFeesCount ?? 0, 'bounce fee', 'bounce fees')} unpaid · ${fmtAed(fin.bounceFeesAmount ?? 0)}`, consequence: 'Charged to the customer for a returned cheque and not yet paid.', due: 'Unpaid', action: { label: 'Open receivables', href: receivablesHref } });
  }
  const dueNext = (dueSoon ?? []).filter(c => c.state === 'due' && c.dueDate && c.dueDate.slice(0, 10) >= today);
  if (dueNext.length > 0) {
    const first = dueNext.map(c => (c.dueDate as string).slice(0, 10)).sort()[0];
    const total = dueNext.reduce((a, c) => a + c.amount, 0);
    const inDays = ymdDiff(today, first);
    todayItems.push({ key: 'due7', band: 3, tone: 'info', icon: Banknote, title: `${plural(dueNext.length, 'cheque', 'cheques')} due in the next 7 days · ${fmtAed(total)}`, consequence: 'Deposit them on the day so nothing slips into overdue.', due: inDays === 0 ? 'First due today' : `First in ${daysWord(inDays)} · ${fmtShortDay(first)}`, dueAt: new Date(first).getTime(), action: { label: 'Open receivables', href: receivablesHref } });
  }

  // 4 · Listings sent back — rejected or changes requested (dashboard-stats units).
  for (const u of units) {
    if (u.listingStatus !== 'rejected' && u.listingStatus !== 'changes_requested') continue;
    const rejected = u.listingStatus === 'rejected';
    todayItems.push({
      key: `listing-${u.id}`, band: 4, tone: rejected ? 'bad' : 'warn', icon: ListX,
      title: `Listing ${rejected ? 'rejected' : 'needs changes'} — ${unitName(u.number, u.building)}`,
      consequence: u.availability === 'available' ? 'Vacant and not visible to customers until it is fixed and resubmitted.' : 'Fix and resubmit so the listing is ready when the unit frees up.',
      due: rejected ? 'Rejected' : 'Changes requested',
      action: { label: 'Fix listing', href: unitsListingHref(u.id) },
    });
  }

  // 5 · Lead follow-ups (the old attention card — same rule, Leads page getUrgency thresholds).
  if (leadStats && leadStats.needAction > 0) todayItems.push({ key: 'leads', band: 5, tone: 'warn', icon: UserRoundSearch, title: `${plural(leadStats.needAction, 'lead needs', 'leads need')} a follow-up`, consequence: 'Viewing outcomes to record, stale payment plans, payment advice to collect.', due: 'Waiting on you', action: { label: 'Open leads', href: leadsHref } });

  // 6 · Today's diary — viewings and move-ins on today's Dubai date.
  for (const { lead, v } of leadStats?.viewingsToday ?? []) {
    const at = new Date(v.scheduledAt).getTime();
    const done = v.status === 'completed' || at < tickMs;
    const needsOutcome = v.status !== 'completed' && at < tickMs;
    todayItems.push({
      key: `viewing-${v.id}`, band: 6, tone: 'info', icon: CalendarDays,
      title: `Viewing — ${ovLeadName(lead)}`,
      consequence: [lead.unit ? unitName(lead.unit.unitNumber, lead.unit.property?.buildingName) : null, humanize(v.status)].filter(Boolean).join(' · '),
      due: `${done ? 'Was at' : 'At'} ${fmtClock(v.scheduledAt)}`, dueAt: at,
      action: { label: needsOutcome ? 'Record outcome' : 'Open lead', href: leadHref(lead.id) },
    });
  }
  for (const u of units) {
    if (u.availability !== 'occupied' || !u.startsOn || u.startsOn.slice(0, 10) !== today) continue;
    todayItems.push({
      key: `movein-${u.id}`, band: 6, tone: 'info', icon: DoorOpen,
      title: `Move-in — ${unitName(u.number, u.building)}${u.tenant ? ` · ${u.tenant}` : ''}`,
      consequence: 'The lease starts today — hand over keys and complete the move-in inspection.',
      due: 'Today',
      action: u.contractId != null ? { label: 'Open lease', href: contractHref(u.contractId, 'lease', manager) } : { label: 'Open unit', href: unitsListingHref(u.id) },
    });
  }

  const todayFailed = [
    leadsErr && !leads ? 'leads' : null,
    statsErr && !stats ? 'units & listings' : null,
    finErr && !fin ? 'cheques' : null,
    todayErr.leases ? 'Ejari status' : null,
    todayErr.renewals ? 'renewal notices' : null,
    todayErr.cheques ? 'cheques due this week' : null,
    !manager && profileErr ? 'verification' : null,
  ].filter(Boolean) as string[];
  const todayLoading = leads == null || stats == null || fin == null || todayContracts == null || todayRenewals == null;

  const eye = <Eye size={10} aria-hidden style={{ marginLeft: 4, verticalAlign: '-1px' }} />;
  const arrow = <ArrowUpRight size={10} aria-hidden style={{ marginLeft: 4, verticalAlign: '-1px' }} />;

  return (
    <OsPage>
      <PageHead
        eyebrow="Overview"
        title={`${greeting}, ${firstName}`}
        lede={<><span>{dateLine}</span> · {summary}</>}
        actions={<>
          <Btn onClick={() => { void refreshEverything(); }} disabled={refreshing} title="Refresh all dashboard data">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} aria-hidden /> {refreshing ? 'Refreshing' : 'Refresh'}
          </Btn>
          <Btn href={reportsHref}>Reports</Btn>
          <Btn href={createListingHref} variant="primary">Create listing</Btn>
        </>}
      />

      <ScopeStrip items={[
        { label: 'Workspace', value: 'Overview' },
        { label: 'Business', value: manager ? 'Managed portfolio' : (profile?.companyName || user?.name || '—') },
        ...(verification ? [{ label: 'Verification', value: verification }] : []),
        { label: 'Vertical', value: 'Spaces' },
        { label: 'Data', value: 'Live' },
      ]} />

      {/* Error banner — names what failed, one Retry for all of it. */}
      {(statsErr || finErr || extrasErr) && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="bad" title="Some data didn't load.">
            {[statsErr && 'portfolio stats', finErr && 'financials', extrasErr && 'activity'].filter(Boolean).join(', ')} failed to refresh.{' '}
            <Btn size="xs" variant="danger" onClick={() => { void refreshAll(); }} disabled={refreshing}>Retry</Btn>
          </Callout>
        </div>
      )}

      {/* Fee rules setup nudge (landlord only) */}
      {feeRulesConfigured === false && !nudgeDismissed && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="warn" title="Set up your fee rules.">
            Configure admin fees, Contract Registration, commission, and security deposits so they auto-fill on every new contract.
            <span className="gx-btn-row" style={{ marginTop: 8 }}>
              <OpenLink href="/rental-provider/dashboard/settings">Configure</OpenLink>
              <Btn size="xs" variant="ghost" onClick={() => setNudgeDismissed(true)}><X size={11} aria-hidden /> Dismiss</Btn>
            </span>
          </Callout>
        </div>
      )}

      {/* Today — one queue ranked by consequence (replaces the attention row;
          every card it had is an item here, same figures, same destination). */}
      <TodayQueue
        items={todayItems}
        loading={todayLoading}
        failed={todayFailed}
        onRetry={() => { void refreshEverything(); }}
        right={<Btn size="sm" href={leadsHref}>Leads queue</Btn>}
      />

      {/* KPI row 1 — what the portfolio is made of, and who runs it. Each opens
          the page that owns the records (new tab), and reads "…" until loaded. */}
      <Kpis>
        <KpiLink k="Properties" v={shown(totalProperties)} href={propertiesHref} icon={arrow} />
        <KpiLink k="Units" v={shown(totalUnits)} href={unitsHref} icon={arrow} />
        <KpiLink k="Customers" v={shown(totalCustomers)} href={customersHref} icon={arrow} />
        <KpiLink k="Active leases" v={shown(activeLeases)} href={leasesHref} icon={arrow} />
        <KpiLink k="Managers" v={shown(totalManagers)} href={managersHref ?? undefined} icon={managersHref ? arrow : null} />
        {/* "Response within 15 min (30 days)" is not computable: the leads API has no
            first-response timestamp. What IS known is how many open clocks have
            run past the 15-min target (lib/os/sla) — the same number the Leads queue shows. */}
        <KpiLink
          k={`Leads waiting > ${FIRST_RESPONSE_SLA_LABEL}`}
          v={leads ? String(leadsWaitingOverSla) : (leadsErr ? '—' : '…')}
          d={leads ? `${leadAwaitingReply.length} awaiting a first reply` : 'first-reply clock'}
          href={leadsHref}
          icon={arrow}
          newTab={false}
        />
      </Kpis>

      {/* KPI row 2 — money and arrears. Rent vs Market and Deposits are live
          snapshots; Overdue / Bounced / Bounce fees open their own drill-downs. */}
      <Kpis>
        <KpiLink
          dark
          k="Rent vs market"
          icon={arrow}
          href={rentVsMarketHref}
          v={rentPos ? fmtAed(rentPos.contracted) : (statsErr ? '—' : '…')}
          d={<>
            {marketRent != null ? `of ${fmtAed(marketRent)} market` : ''}
            {marketGapPct != null && (
              <span style={{ marginLeft: 6, fontWeight: 700, color: marketGapPct > 0 ? '#fca5a5' : '#86efac', whiteSpace: 'nowrap' }}>
                {marketGapPct > 0 ? <TrendingDown size={11} aria-hidden style={{ verticalAlign: '-1px' }} /> : <TrendingUp size={11} aria-hidden style={{ verticalAlign: '-1px' }} />}
                {' '}{marketGapPct > 0 ? '−' : '+'}{Math.abs(marketGapPct).toFixed(2)}% {marketGapPct > 0 ? 'below market' : 'above market'}
              </span>
            )}
          </>}
        />
        <KpiLink
          k="Deposits held"
          icon={arrow}
          href={depositsHref}
          newTab={false}
          v={fin ? fmtAed(fin.depositsHeld) : (finErr ? '—' : '…')}
          d={fin ? `across ${fin.depositsHeldCount} leases` : undefined}
        />
        <KpiButton
          k={<>Overdue{eye}</>}
          v={fin ? fmtAed(fin.overdueAmount) : (finErr ? '—' : '…')}
          d={fin ? `${fin.overdueCount} cheque${fin.overdueCount === 1 ? '' : 's'} past their date` : 'past due cheques'}
          warn={(fin?.overdueCount ?? 0) > 0}
          onClick={drillOverdue}
          label="Open overdue cheques"
        />
        <KpiButton
          k={<>Bounced{eye}</>}
          v={fin ? fmtAed(fin.bouncedAmount) : (finErr ? '—' : '…')}
          d={fin ? `${fin.bouncedCount} cheque${fin.bouncedCount === 1 ? '' : 's'} the bank refused${bouncedPartPaid ? ` · ${bouncedPartPaid} part-paid` : ''}` : 'returned cheques'}
          warn={(fin?.bouncedCount ?? 0) > 0}
          onClick={drillBounced}
          label="Open bounced cheques"
        />
        {fin?.bounceFees && (
          <KpiButton
            k={<>Bounce fees{eye}</>}
            v={fmtAed(fin.bounceFeesAmount ?? 0)}
            d={`${fin.bounceFeesCount ?? 0} fee${fin.bounceFeesCount === 1 ? '' : 's'} not yet paid`}
            warn={(fin.bounceFeesCount ?? 0) > 0}
            onClick={drillBounceFees}
            label="Open unpaid bounce fees"
          />
        )}
      </Kpis>

      {/* Receivables — hidden by SHOW_RECEIVABLES (SCRUM-737). Restoring it is
          the flag: period select, cheque drill-down and Cash Management link. */}
      {SHOW_RECEIVABLES && (
        <div style={{ marginBottom: 14 }}>
          <Card
            title="Receivables"
            sub={fin ? `${fmtAed(fin.receivablesSplit.collected.amount)} collected · ${fmtAed(fin.receivablesSplit.overdue.amount + fin.receivablesSplit.due.amount)} outstanding` : (finErr ? 'Not available' : 'Loading…')}
            right={<>
              <select className="gx-sel" aria-label="Receivables period" value={selectedRange} onChange={e => setSelectedRange(e.target.value as RangePreset)}>
                {RANGE_PRESETS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
              </select>
              <Btn size="sm" onClick={drillReceivables} disabled={!fin}>Open cheques</Btn>
              <Btn size="sm" href={cashManagementHref}>Open report</Btn>
            </>}
            pad
          >
            <div style={{ fontSize: 22, fontWeight: 800 }}>{fin ? fmtAed(fin.receivablesInRange) : (finErr ? '—' : '…')}</div>
          </Card>
        </div>
      )}

      {/* Occupancy | Upcoming renewals */}
      <Cols kind="2e">
        <Card
          title="Occupancy rate"
          sub={totalUnits ? `${occupied} of ${totalUnits} units let${stats?.leasedAhead ? ` · ${stats.leasedAhead} ${stats.leasedAhead === 1 ? 'starts' : 'start'} later` : ''}` : 'Across all units in your portfolio'}
          pad
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 150, height: 150, flexShrink: 0 }}>
              <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }} aria-hidden>
                <circle cx="50" cy="50" r="40" fill="none" stroke="var(--ms-surface-3)" strokeWidth="12" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="var(--ms-primary)" strokeWidth="12" strokeLinecap="round"
                  strokeDasharray={`${(gaugePct / 100) * dashLen} ${dashLen}`} style={{ transition: 'stroke-dasharray .6s ease' }} />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{statsReady ? `${occupancyRate}%` : '…'}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>Occupancy</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8, flex: 1, minWidth: 180 }}>
              {/* Both halves open: vacant = what is costing money, occupied = what is earning it. */}
              <Btn size="sm" onClick={drillOccupied}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ms-primary)', display: 'inline-block' }} /> Occupied {statsReady ? occupied : '…'} · Open list</Btn>
              <Btn size="sm" onClick={drillAvailable}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ms-border-strong)', display: 'inline-block' }} /> Vacant {statsReady ? available : '…'} · Open list</Btn>
              {vacancyTotals && vacancyTotals.units > 0 && (
                <span style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>
                  Empty for {fmtDuration(vacancyTotals.avgDaysVacant)} on average · {fmtAed(vacancyTotals.lostIncome)} foregone
                </span>
              )}
            </div>
          </div>
        </Card>
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
          manager={manager}
        />
      </Cols>

      {/* Where leads come from | Today */}
      <Cols kind="2e">
        <Card
          title="Where your leads come from"
          sub={leadStats ? `${leadStats.total} leads on record · ${leadStats.open} open · ${leadStats.new30} new in 30 days` : leadsErr ? 'Not available' : 'Loading…'}
          right={<Btn size="sm" href={leadsHref}>Open leads</Btn>}
          pad
        >
          {leadsErr && !leads ? (
            <Callout tone="bad" title="Couldn't load leads.">
              <Btn size="xs" onClick={() => { void fetchLeads(); }}>Try again</Btn>
            </Callout>
          ) : !leadStats ? (
            <div style={{ display: 'grid', gap: 9 }}>{[0, 1, 2].map(i => <div key={i} className="gx-skel" style={{ height: 10 }} />)}</div>
          ) : leadStats.sources.length === 0 ? (
            <div className="gx-empty"><b>No leads yet</b> Enquiries from your published listings appear here by channel.</div>
          ) : (
            <Bars rows={leadStats.sources.slice(0, 8).map(([l, n]) => ({ l, pct: (n / leadStats.sources[0][1]) * 100, v: n }))} />
          )}
        </Card>
        <Card title="Viewings today" sub={`Viewings on ${fmtDayHeadingDubai(today)}`} right={<Btn size="sm" href={leadsHref}>Leads</Btn>} pad>
          {leadsErr && !leads ? (
            <Callout tone="bad" title="Couldn't load today's viewings.">
              <Btn size="xs" onClick={() => { void fetchLeads(); }}>Try again</Btn>
            </Callout>
          ) : !leadStats ? (
            <div style={{ display: 'grid', gap: 9 }}>{[0, 1, 2].map(i => <div key={i} className="gx-skel" style={{ height: 10 }} />)}</div>
          ) : leadStats.viewingsToday.length === 0 ? (
            <div className="gx-empty"><b>No viewings today</b> Viewings scheduled from Leads show here on the day.</div>
          ) : (
            <Timeline items={leadStats.viewingsToday.map(({ lead, v }, i, all) => {
              const isPast = (x: { scheduledAt: string; status: string }) => x.status === 'completed' || new Date(x.scheduledAt).getTime() < nowMs;
              // The first viewing still ahead is "now"; earlier ones are done.
              const firstAhead = all.findIndex(x => !isPast(x.v));
              return {
                state: isPast(v) ? 'done' as const : i === firstAhead ? 'now' as const : undefined,
                t: <Link href={leadHref(lead.id)} style={{ textDecoration: 'underline' }}>{fmtClock(v.scheduledAt)} · Viewing — {lead.customerName}</Link>,
                s: [lead.unit ? `Unit ${lead.unit.unitNumber}` : null, lead.unit?.property?.buildingName, humanize(v.status)].filter(Boolean).join(' · '),
              };
            })} />
          )}
        </Card>
      </Cols>

      {/* Unit performance — the vacant units, longest empty first. */}
      <div style={{ marginBottom: 14 }}>
        <TableWrap toolbar={<>
          <strong style={{ fontSize: 13 }}>Vacant units</strong>
          <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>longest empty first · what each has cost</span>
          <span style={{ marginLeft: 'auto' }}><Btn size="sm" href={unitsHref}>All units</Btn></span>
        </>}>
          {!statsReady ? (
            <table className="gx-tbl"><SkeletonRows rows={4} cols={5} /></table>
          ) : (
            <VacancyTable units={vacantUnits} totals={vacancyTotals} manager={manager} limit={8} onShowAll={drillAvailable} />
          )}
        </TableWrap>
      </div>

      {/* Breach & legal — absent entirely when nothing is open. */}
      {legal && (legal.counts.breaches > 0 || legal.counts.disputes > 0) && (
        <div style={{ marginBottom: 14 }}>
          <LegalCard
            counts={legal.counts}
            open={legal.open}
            legalBase={legalBase}
            opsBase={manager ? '/dashboard/manager/operations' : '/rental-provider/dashboard/operations'}
            rp={manager?.rp}
          />
        </div>
      )}

      {/* Managers — live activity. */}
      <Card
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Manager activity <Pill tone="primary">Live</Pill></span>}
        sub={totalManagers === 0 ? 'nobody has access to this portfolio' : `${totalManagers} with access · what they are doing today · refreshes every 5s · click a row to see what changed`}
        right={!manager ? <Btn size="sm" href="/rental-provider/dashboard/team">Team page</Btn> : undefined}
      >
        <LiveActivity feed={feed} error={feedErr} onRetry={fetchFeed} contractBase={contractBase} leadsBase={leadsBase} />
      </Card>

      <DrillDown drill={drill} onClose={() => setDrill(null)} />
    </OsPage>
  );
}

/* ─── Local KPI variants (the kit Kpi has no onClick / no rel on new tab) ─── */

function KpiLink({ k, v, d, href, dark, icon, newTab = true }: {
  k: string; v: ReactNode; d?: ReactNode; href?: string; dark?: boolean; icon?: ReactNode; newTab?: boolean;
}) {
  const body = <><div className="k">{k}{icon}</div><div className="v">{v}</div>{d && <div className="d">{d}</div>}</>;
  return href
    ? <Link href={href} className={cn('gx-kpi', dark && 'dark')} {...(newTab ? NEW_TAB : {})}>{body}</Link>
    : <div className={cn('gx-kpi', dark && 'dark')}>{body}</div>;
}

function KpiButton({ k, v, d, warn, onClick, label }: {
  k: ReactNode; v: ReactNode; d?: ReactNode; warn?: boolean; onClick: () => void; label: string;
}) {
  return (
    <button type="button" className="gx-kpi" onClick={onClick} aria-label={label} style={{ textAlign: 'left', cursor: 'pointer' }}>
      <div className="k" style={warn ? { color: 'var(--ms-amber-text)' } : undefined}>{k}</div>
      <div className="v">{v}</div>
      {d && <div className="d">{d}</div>}
    </button>
  );
}

/* ─── Drill-down drawer ─────────────────────────────────────────────────── */

const SUMMARY_COLOR: Record<'green' | 'amber' | 'red', string> = {
  green: 'var(--ms-primary-dark)', amber: 'var(--ms-amber-text)', red: 'var(--ms-danger)',
};

function DrillDown({ drill, onClose }: { drill: DrillState | null; onClose: () => void }) {
  const total = drill ? drill.groups.reduce((s, g) => s + g.rows.length, 0) : 0;
  return (
    <Drawer open={!!drill} onClose={onClose} title={drill?.title ?? ''}>
      {drill && (
        <div style={{ display: 'grid', gap: 12 }}>
          {drill.headline && <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{drill.headline}</div>}
          {drill.summary && drill.summary.length > 0 && (
            <KV items={drill.summary.map(s => ({ k: s.label, v: <span style={{ fontWeight: 700, color: s.tone ? SUMMARY_COLOR[s.tone] : undefined }}>{s.value}</span> }))} />
          )}
          {drill.note && <p style={{ fontSize: 11, color: 'var(--ms-ink-3)', lineHeight: 1.5 }}>{drill.note}</p>}
          {drill.loading ? (
            <div style={{ display: 'grid', gap: 9 }}>{[0, 1, 2, 3].map(i => <div key={i} className="gx-skel" style={{ height: 12 }} />)}</div>
          ) : drill.panel ? (
            <div className="gx-tbl-wrap"><div className="gx-tbl-scroll">{drill.panel}</div></div>
          ) : total === 0 ? (
            <div className="gx-empty"><b>Nothing to show.</b></div>
          ) : drill.groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <div className="gx-eyebrow" style={{ margin: '4px 0 6px' }}>{g.label}</div>}
              <div className="gx-tbl-wrap"><div className="gx-tbl-scroll">
                <table className="gx-tbl">
                  <tbody>
                    {g.rows.map(r => (
                      <tr key={r.key}>
                        <td className="strong">{r.title}{r.subtitle && <span className="sub">{r.subtitle}</span>}</td>
                        <td className="nowrap">{r.badges?.map((b, bi) => <span key={bi} style={{ marginRight: 4 }}><Pill tone={PILL_TONE[b.tone]}>{b.label}</Pill></span>)}</td>
                        {r.amount != null && <td className="num strong">{r.amount}</td>}
                        <td className="act">{r.href ? <OpenLink href={r.href} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

/* ─── Breach & legal ────────────────────────────────────────────────────── */

/** Two tiles; clicking one lists that tile's open records, one line each: the
 *  unit, the customer, and the stage the record is at now. A breach opens on
 *  its lease, a case on its Legal page. Manager routes carry `?rp=`. */
function LegalCard({ counts, open, legalBase, opsBase, rp }: {
  counts: { breaches: number; disputes: number };
  open?: { breaches: OpenRecord[]; cases: OpenRecord[] };
  legalBase: string;
  opsBase: string;
  rp?: number;
}) {
  const q = rp != null ? `?rp=${rp}` : '';
  const [pick, setPick] = useState<'breaches' | 'cases' | null>(null);
  const rows = pick === 'breaches' ? (open?.breaches ?? []) : pick === 'cases' ? (open?.cases ?? []) : [];
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short' }) : null;
  const hrefOf = (r: OpenRecord) => (pick === 'cases' ? `${legalBase}/${r.id}${q}` : `${opsBase}/${r.leaseId}${q}#sec-breaches`);
  return (
    <Card title="Breach & legal" sub="Open a figure to see the units and where each one stands." right={<Btn size="sm" href={`${legalBase}${q}`}>Legal</Btn>} pad>
      <Kpis>
        <KpiButton k={<>Open breaches<Eye size={10} aria-hidden style={{ marginLeft: 4 }} /></>} v={counts.breaches} warn={counts.breaches > 0} onClick={() => setPick('breaches')} label="Open breaches list" />
        <KpiButton k={<>Open cases<Eye size={10} aria-hidden style={{ marginLeft: 4 }} /></>} v={counts.disputes} warn={counts.disputes > 0} onClick={() => setPick('cases')} label="Open cases list" />
      </Kpis>
      <Drawer
        open={pick != null}
        onClose={() => setPick(null)}
        title={pick === 'cases' ? 'Open cases' : 'Open breaches'}
        sub={`${rows.length} ${pick === 'cases' ? (rows.length === 1 ? 'case' : 'cases') : (rows.length === 1 ? 'breach' : 'breaches')} · each with the stage it is at now`}
      >
        <div className="gx-tbl-wrap"><div className="gx-tbl-scroll">
          <table className="gx-tbl">
            <thead><tr><th>Unit</th><th>Stage</th><th>Next</th><th className="act" aria-label="Actions" /></tr></thead>
            {rows.length === 0 ? <EmptyRow cols={4} title="Nothing open." /> : (
              <tbody>
                {rows.map(r => (
                  <tr key={`${pick}-${r.id}`}>
                    <td className="strong">
                      {r.unitNumber ? `Unit ${r.unitNumber}` : 'Unit —'}{r.buildingName ? ` · ${r.buildingName}` : ''}
                      <span className="sub">{[r.customerName, r.label].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td><Pill tone={pick === 'cases' ? 'info' : 'amber'}>{r.stageLabel}</Pill></td>
                    <td className="nowrap">{fmt(r.nextDate) ?? '—'}</td>
                    <td className="act"><OpenLink href={hrefOf(r)} newTab={false} /></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div></div>
      </Drawer>
    </Card>
  );
}

/* ─── Upcoming renewals ─────────────────────────────────────────────────── */

/** Upcoming renewals split into the states a lease can be in — a PARTITION
 *  that sums to the headline. `noticeDue` is the landlord's own next action;
 *  Notice Sent waits on the customer; Agreed / Declined are settled. Every
 *  bucket renders even at 0 (Declined only once there is one). */
function RenewalsCard({ list, buckets, loading, error, onRetry, windowDays, onWindowChange, allHref, onDrillBucket, manager }: {
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
  manager?: { rp: number };
}) {
  // Fall back to counting the list when the API predates `renewalBuckets`.
  const counts = buckets ?? list.reduce((acc, r) => {
    const k = r.bucket ?? 'noticeDue';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, { renewed: 0, noticeSent: 0, noticeDue: 0, newCustomer: 0, vacating: 0 } as Record<RenewalBucket, number>);
  const total = RENEWAL_BUCKETS.reduce((n, b) => n + (counts[b.key] ?? 0), 0);
  const tiles = RENEWAL_BUCKETS.filter(b => b.key !== 'vacating' || (counts.vacating ?? 0) > 0);
  // The soonest terms coming to an end, as a timeline.
  const next = list.filter(r => r.placedBy !== 'start').slice().sort((a, b) => a.daysUntilEnd - b.daysUntilEnd).slice(0, 5);
  const termDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <Card
      title="Upcoming renewals"
      sub={loading ? 'Loading…' : `${total} renewal${total === 1 ? '' : 's'} this month and the next ${windowDays} days`}
      right={
        <select className="gx-sel" value={windowDays} onChange={e => onWindowChange(Number(e.target.value) as RenewalWindow)} aria-label="Renewal horizon" style={{ height: 28 }}>
          {RENEWAL_WINDOWS.map(w => <option key={w} value={w}>{w} days</option>)}
        </select>
      }
      pad
    >
      {error && loading ? (
        <Callout tone="bad" title="Couldn't load renewals."><Btn size="xs" onClick={onRetry}>Try again</Btn></Callout>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <Bars rows={tiles.map(b => ({
            l: `${b.label} — ${b.hint}`,
            pct: total ? ((counts[b.key] ?? 0) / total) * 100 : 0,
            v: loading ? '…' : (counts[b.key] ?? 0),
            tone: b.tone === 'amber' ? 'amber' as const : b.tone === 'red' ? 'danger' as const : undefined,
          }))} />
          <div className="gx-btn-row">
            {tiles.map(b => {
              const n = counts[b.key] ?? 0;
              return (
                <Btn key={b.key} size="sm" onClick={() => onDrillBucket(b.key)} disabled={loading || n === 0}>
                  Open {b.label} · {loading ? '…' : n}
                </Btn>
              );
            })}
          </div>
          {next.length > 0 && (
            <Timeline items={next.map(x => ({
              state: x.daysUntilEnd <= 0 ? 'bad' as const : undefined,
              mark: x.daysUntilEnd <= 0 ? '!' : undefined,
              t: <Link href={contractHref(x.openContractId ?? x.contractId, x.openIn ?? 'lease', manager)} style={{ textDecoration: 'underline' }}>{x.unitLabel} · {x.tenantName ?? 'Customer'}</Link>,
              s: <>{x.daysUntilEnd <= 0 ? `ended ${Math.abs(x.daysUntilEnd)}d ago` : `ends in ${x.daysUntilEnd}d`} · {termDay(x.endDate)} · <Pill tone={PILL_TONE[bucketBadge(x).tone]}>{bucketBadge(x).label}</Pill></>,
            }))} />
          )}
          {/* Renewals are worked in the Operations Renewal pipeline. */}
          {total === 0 ? (
            <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>No renewals this month or in the next {windowDays} days</span>
          ) : (
            <span><Btn size="sm" href={allHref}>View all {total} renewals</Btn></span>
          )}
        </div>
      )}
    </Card>
  );
}

/* ─── Live manager activity ─────────────────────────────────────────────── */

/** What the people running this portfolio are doing, re-read every 5 seconds.
 *  One column per manager, rows under the day they happened on; clicking a row
 *  opens what actually changed. Ages are computed against the feed's own
 *  `generatedAt`, not the browser clock. A failed poll keeps the last rows. */
function LiveActivity({ feed, error, onRetry, contractBase, leadsBase }: {
  feed: ManagerFeed | null;
  error: string | null;
  onRetry: () => void;
  contractBase: string;
  leadsBase: string;
}) {
  const [detail, setDetail] = useState<{ entry: FeedEntry; who: string } | null>(null);
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
  // Guarded: a payload from a previous build must not crash the dashboard.
  const lanes = feed?.managers ?? [];
  const feedWindow = feed?.window ?? [];

  if (error && !feed) {
    return <div className="gx-pad"><Callout tone="bad" title="Couldn't load manager activity."><Btn size="xs" onClick={onRetry}>Try again</Btn></Callout></div>;
  }
  if (!feed) return <table className="gx-tbl"><SkeletonRows rows={4} cols={3} /></table>;
  if (lanes.length === 0) {
    return <div className="gx-empty"><b>No managers on this portfolio yet</b> Invite one and their work appears here as they do it.</div>;
  }

  return (
    <>
      <div className={lanes.length === 1 ? '' : 'gx-cols gx-cols-2e'} style={{ gap: 0 }}>
        {lanes.map((m, mi) => {
          const byDay = new Map<string, FeedEntry[]>();
          for (const e of m.entries) {
            const arr = byDay.get(e.day) ?? [];
            arr.push(e);
            byDay.set(e.day, arr);
          }
          const totalFor = new Map(m.dayTotals?.map(d => [d.day, d.count]) ?? []);
          const viewsFor = new Map(m.dayViews?.map(d => [d.day, d.count]) ?? []);
          const days = feedWindow.map(day => ({ day, rows: byDay.get(day) ?? [], total: totalFor.get(day) ?? 0, views: viewsFor.get(day) ?? 0 }));
          const actions = m.dayTotals?.reduce((s, d) => s + d.count, 0) ?? 0;
          const pages = m.dayViews?.reduce((s, d) => s + d.count, 0) ?? 0;
          const who = m.name ?? `Manager #${m.userId}`;
          return (
            <div key={m.userId} style={{ minWidth: 0, borderLeft: mi > 0 ? '1px solid var(--ms-surface-3)' : undefined }}>
              <div className="gx-pad" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', background: 'var(--ms-surface-2)' }}>
                <strong style={{ fontSize: 12.5 }}>{who}</strong>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ms-ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                  {actions > 0
                    ? `${actions} action${actions === 1 ? '' : 's'}${pages > 0 ? ` · ${pages} page${pages === 1 ? '' : 's'}` : ''} today · last ${ago(m.lastAt!)}`
                    : pages > 0
                    ? `${pages} page${pages === 1 ? '' : 's'} read today · no changes`
                    : m.lastAt ? `nothing today · last seen ${ago(m.lastAt)}` : 'nothing yet'}
                </span>
              </div>
              {days.map(({ day, rows, total, views }) => {
                const shownActions = rows.filter(e => e.category !== 'Viewing').reduce((s, e) => s + (e.repeats ?? 1), 0);
                const shownViews = rows.filter(e => e.category === 'Viewing').reduce((s, e) => s + (e.repeats ?? 1), 0);
                const trimmed = [
                  total > shownActions ? `${shownActions} of ${total} actions` : null,
                  views > shownViews ? `${shownViews} of ${views} pages` : null,
                ].filter(Boolean);
                return (
                  <div key={day}>
                    <div style={{ padding: '6px 16px', borderTop: '1px solid var(--ms-surface-3)', display: 'flex', gap: 8, fontSize: 11 }}>
                      <strong>{fmtDayHeading(day)}</strong>
                      <span style={{ marginLeft: 'auto', color: 'var(--ms-ink-3)' }}>
                        {[total ? `${total} action${total === 1 ? '' : 's'}` : null, views ? `${views} page${views === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'no activity'}
                      </span>
                    </div>
                    {trimmed.length > 0 && <p style={{ padding: '0 16px 4px', fontSize: 10.5, color: 'var(--ms-ink-3)' }}>showing the latest {trimmed.join(' · ')}</p>}
                    <table className="gx-tbl">
                      {rows.length === 0 ? <EmptyRow cols={3} title="—" /> : (
                        <tbody>
                          {rows.map(e => {
                            const to = openHref(e);
                            const n = e.repeats ?? 1;
                            return (
                              <tr key={e.id} className="click" onClick={() => setDetail({ entry: e, who })}>
                                <td className="nowrap mono">{n > 1 ? `${fmtClock(e.firstAt)}–${fmtClock(e.at)}` : fmtClock(e.at)}</td>
                                <td style={{ width: '100%' }}>
                                  <button type="button" onClick={(ev) => { ev.stopPropagation(); setDetail({ entry: e, who }); }} title="See what changed" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}>
                                    <Pill tone={categoryTone(e.category)} dot={false}>{e.category}</Pill>{' '}
                                    <span className="strong">{e.label}</span>
                                    {n > 1 && <> <Pill tone="outline" dot={false} title={`${n} times`}>×{n}</Pill></>}
                                  </button>
                                  {(e.subject || e.why) && (
                                    <span className="sub">
                                      {e.subject}
                                      {e.why && <span style={{ color: 'var(--ms-amber-text)' }}>{e.subject ? ' — ' : ''}{e.why}</span>}
                                    </span>
                                  )}
                                </td>
                                <td className="act" onClick={ev => ev.stopPropagation()}>{to && <OpenLink href={to} />}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      )}
                    </table>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* What actually changed, for one row. */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.entry.label ?? ''} width={520}>
        {detail && (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>
              {detail.who} · {fmtDayHeading(detail.entry.day)} at {fmtClock(detail.entry.at)}
              {(detail.entry.repeats ?? 1) > 1 && ` · ${detail.entry.repeats} times from ${fmtClock(detail.entry.firstAt)}`}
              {detail.entry.subject && ` · ${detail.entry.subject}`}
            </p>
            {detail.entry.category === 'Viewing' ? (
              <div className="gx-empty">Opened this page{(detail.entry.repeats ?? 1) > 1 ? ` ${detail.entry.repeats} times` : ''} — nothing was changed.</div>
            ) : !detail.entry.changes?.length ? (
              <div className="gx-empty">This action recorded no field-level changes.</div>
            ) : (
              <table className="gx-tbl">
                <thead><tr><th>Field</th><th>From</th><th>To</th></tr></thead>
                <tbody>
                  {detail.entry.changes.map((c, i) => (
                    <tr key={i}>
                      <td className="strong">{c.field}</td>
                      <td style={{ textDecoration: 'line-through', color: 'var(--ms-ink-3)' }}>{c.from ?? '—'}</td>
                      <td className="strong">{c.to ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AE', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
/** 'YYYY-MM-DD' → 'Tue, 4 Aug 2026'. The string is ALREADY a Dubai calendar day,
 *  so it is read back as UTC — re-interpreting it in the viewer's zone is what
 *  would shift the header off the day the rows were grouped under. */
const fmtDayHeading = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-AE', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
const fmtDayHeadingDubai = fmtDayHeading;

/** RP route entry point — the landlord's own dashboard home. */
export default function RentalProviderDashboard() {
  return <RpDashboardHome />;
}
