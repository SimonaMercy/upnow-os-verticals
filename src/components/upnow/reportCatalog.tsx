/**
 * Shared report catalog — group structure + tiles for BOTH report hubs
 * (RP /rental-provider/dashboard/reports and the manager portal). One list so
 * the portals can't drift.
 */
import {
  FileText, BarChart2, Building2, CalendarClock,
  RefreshCw, MapPin, Wallet, ShieldCheck, Users, FileBarChart, ScrollText,
  Banknote, TrendingUp, ListChecks, CalendarDays, Activity,
} from 'lucide-react';

export type GroupKey = 'portfolio' | 'leasing' | 'renewals' | 'collections' | 'financial' | 'operations' | 'missingdata';

export interface ReportTile {
  slug: string;
  title: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  available: boolean;
  group: GroupKey;
  /** RP-hub only — never shown in (or served to) the manager portal. */
  rpOnly?: boolean;
  /** Temporarily hide the tile from every hub (route still works if reached
   *  directly). Flip off to bring the report back. */
  hidden?: boolean;
}

/** Section order + headers for the grouped hub. Coming-soon reports sit
 *  greyed-out inside their natural group rather than in a separate dump. */
export const GROUPS: { key: GroupKey; title: string; blurb: string; Icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { key: 'portfolio',   title: 'Portfolio & Occupancy',  blurb: 'What you own and how full it is.',                          Icon: FileBarChart },
  { key: 'leasing',     title: 'Leasing Activity',       blurb: 'New leases signed — registers, matrices and monthly activity.', Icon: FileText },
  { key: 'renewals',    title: 'Renewals & Expiry',      blurb: 'The forward book — expiries, renewal plans and rent uplift.',   Icon: RefreshCw },
  { key: 'collections', title: 'Rent & Collections',     blurb: 'Money in — rent roll, cheques, receivables, cashflow.',     Icon: Wallet },
  { key: 'financial',   title: 'Financial & Compliance', blurb: 'Deposits, fees, VAT and statements.',                       Icon: ScrollText },
  { key: 'operations',  title: 'Manager Activity',       blurb: 'How your managers are performing, day by day.',             Icon: Users },
];

export const REPORT_TILES: ReportTile[] = [
  // ── Portfolio & Occupancy ──────────────────────────────────────────────
  { slug: 'portfolio',          title: 'Portfolio',         description: 'Units, occupied counts, and the rent roll per property.',              Icon: Building2,    available: true,  group: 'portfolio' },
  { slug: 'portfolio-overview', title: 'Unit Mix',       description: 'Units by type, occupancy, and annual asking rent.',                    Icon: FileBarChart, available: true,  group: 'portfolio' },
  { slug: 'vacancy-analysis',   title: 'Vacant Units',         description: 'Vacant units with last rent, market rent and asking rent at stake.',              Icon: MapPin,       available: true,  group: 'portfolio' },
  // ── Leasing Activity ───────────────────────────────────────────────────
  { slug: 'leasing-activity',   title: 'Contract Registration Activity', description: 'New leases per month, rent signed, and Contract Registration status.',                 Icon: CalendarClock, available: true, group: 'leasing', hidden: true },
  { slug: 'leases-by-year',     title: 'Leases - Monthly',           description: 'The annual lease register grouped by commencement month — expand a month to see the leases that began then, with customer, unit, term dates, rent and status.', Icon: FileText, available: true, group: 'leasing' },
  { slug: 'new-leases-matrix',  title: 'Lease Summary - Yearly',       description: 'Property × month grid of leases commencing each month of the year (the matrix companion to Contract Registration Activity), with new-lease counts and annual rent per property.', Icon: CalendarClock, available: true, group: 'leasing' },
  { slug: 'lease-revenue-by-year', title: 'Lease Revenue by Year', description: 'Each lease\'s rent allocated to the calendar years its term actually covers — driven by the lease period, not the signing date. One row per lease with a column per year, a Summary-by-Year rollup, renewal chains grouped together, and a 90-day expiry flag for chasing renewals. Exportable to CSV.', Icon: TrendingUp, available: true, group: 'leasing', hidden: true },
  { slug: 'lease-activity',     title: 'Lease Activity',      description: 'Month-by-month operations sheet — renewals due, new & renewal contracts, deposits, notices, customer & landlord online signatures, Contract Registration completed vs pending, move-outs, and average days to signature. Exportable to CSV in the executive format.', Icon: ScrollText, available: true, group: 'leasing', hidden: true },
  { slug: 'leasing-funnel',     title: 'Leasing Funnel by Manager',      description: 'The leasing journey as a month-by-month funnel — how many contracts reached each stage: Lead Received, Viewing Done, KYC Verified, Deposit Collected, Renewal Notice Sent, Customer & Landlord Signed, Contract Registration pending vs done, Activated, Move-out Inspection and Settlement Signed. Exportable to CSV.', Icon: ListChecks, available: true, group: 'operations' },
  // ── Renewals & Expiry ──────────────────────────────────────────────────
  { slug: 'lease-expiry',       title: 'Upcoming Renewals',        description: 'Leases ending within 30 / 60 / 90 / 180 / 365 days, grouped by the month they come up for renewal.', Icon: CalendarClock, available: true, group: 'renewals' },
  { slug: 'renewal-forecast',   title: 'Renewal Plan - Monthly',    description: 'Every lease up for renewal in a year, month by month with annual rent — expand a month for the per-customer detail.',  Icon: RefreshCw,    available: true,  group: 'renewals' },
  { slug: 'renewal-vacancy',    title: 'Renewal Plan - Yearly',     description: 'Per-property summary for a year — occupied units by renewal month + Vacant + Total units, straight from each unit\'s Available/Occupied status. Click Vacant to list the units.', Icon: Building2, available: true, group: 'renewals' },
  { slug: 'rent-vs-market',     title: 'Rent vs Asking',           description: 'Current contracted rent vs the unit’s asking price — uplift recoverable at renewal.', Icon: TrendingUp, available: true, group: 'renewals' },
  // ── Rent & Collections ─────────────────────────────────────────────────
  { slug: 'rent-collection',    title: 'Cash Management', description: 'Collection matrix — every unit down, months across, with annual rent and year-to-date expected vs received.',          Icon: BarChart2,    available: true,  group: 'collections' },
  { slug: 'cheques-management', title: 'Cheques Management', description: 'Cheque schedule — one row per active lease with each rent cheque\'s due date and a 12-month grid of how many cheques land each month.', Icon: CalendarDays, available: true,  group: 'collections' },
  { slug: 'executive-cashflow', title: 'Executive Cashflow',        description: 'The month-by-month cashflow dashboard — rent expected vs received, pending and bounced, penalty income, and Net Income, with full-year totals. Anchored on the cheque date; latest lease per unit (reconciles with Cash Management).', Icon: TrendingUp, available: true, group: 'collections' },
  // ── Financial & Compliance ─────────────────────────────────────────────
  { slug: 'security-deposits',  title: 'Security Deposits Report', description: 'Deposit register with lifecycle — held, returned, forfeited.',         Icon: ShieldCheck,  available: true,  group: 'financial' },
  { slug: 'fee-taxation',       title: 'Fee & VAT (Taxation)',     description: 'Admin, Contract Registration & commission fees, rent VAT and third-party pass-throughs per year — net, VAT and gross.', Icon: ScrollText,  available: true, group: 'financial' },
  { slug: 'payment-grouping',   title: 'Payment Grouping (custom)', description: 'Build your own statement — drag payment types into categories you name; Contract Registration splits into DLD + service. Per-year, session-only.', Icon: Banknote, available: true, group: 'financial', rpOnly: true },
  // ── Manager activity ───────────────────────────────────────────────────
  { slug: 'manager-operations', title: 'Manager Operations Report', description: 'The manager evaluation report — today / this week / this month compared to the previous period, day-by-day figures per manager, leases delivered, every stage as a clickable column, stage timing with customer & landlord wait separated, and what’s stuck right now. “On file” signatures are not counted. Landlord-only.', Icon: ListChecks, available: true, group: 'operations', rpOnly: true },
  { slug: 'activity-log', title: 'Activity Log', description: 'Every recorded action in the shape an owner reads it — when, who (person and role, and who they acted for), what, where (lease · unit · property · customer), what changed before → after, and why. Includes a coverage matrix of every catalogued action and how often each line of the record can actually be filled. Anything never captured says so explicitly instead of showing a bare verb.', Icon: Activity, available: true, group: 'operations', rpOnly: true },
  { slug: 'operations-by-stage', title: 'Operations by Stage', description: 'Records each manager progressed, stage by stage — the operations pipeline matrix on its own. Click any number to see the records behind it with their history. Managers can open it to see their own activity and pipeline. “On file” signatures are not counted.', Icon: ListChecks, available: true, group: 'operations', hidden: true },
];

