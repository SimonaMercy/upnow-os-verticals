/**
 * Shared report catalog — group structure + tiles for BOTH report hubs
 * (RP /rental-provider/dashboard/reports and the manager portal). One list so
 * the portals can't drift.
 */
import {
  FileText, BarChart2, Building2, AlertCircle, CalendarClock,
  RefreshCw, MapPin, Wallet, ShieldCheck, Users, Wrench, FileBarChart, ScrollText,
  Banknote, TrendingUp, ClipboardList, ListChecks,
} from 'lucide-react';

export type GroupKey = 'portfolio' | 'leasing' | 'collections' | 'financial' | 'operations' | 'missingdata';

export interface ReportTile {
  slug: string;
  title: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  available: boolean;
  group: GroupKey;
  /** RP-hub only — never shown in (or served to) the manager portal. */
  rpOnly?: boolean;
}

/** Section order + headers for the grouped hub. Coming-soon reports sit
 *  greyed-out inside their natural group rather than in a separate dump. */
export const GROUPS: { key: GroupKey; title: string; blurb: string; Icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { key: 'portfolio',   title: 'Portfolio & Occupancy',  blurb: 'What you own and how full it is.',                      Icon: FileBarChart },
  { key: 'leasing',     title: 'Leasing & Renewals',     blurb: 'Tenancy lifecycle — expiries, renewals, new leases.',   Icon: RefreshCw },
  { key: 'collections', title: 'Rent & Collections',     blurb: 'Money in — rent roll, cheques, receivables, cashflow.', Icon: Wallet },
  { key: 'financial',   title: 'Financial & Compliance', blurb: 'Deposits, fees, VAT and statements.',                   Icon: ScrollText },
  { key: 'operations',  title: 'Data & Operations',      blurb: 'Data quality, vendors and team.',                       Icon: Wrench },
  { key: 'missingdata', title: 'Missing Data Worklists',  blurb: 'Records & fields still to fill — open one, fix it, and it clears. Print to PDF for data entry.', Icon: AlertCircle },
];

export const REPORT_TILES: ReportTile[] = [
  // ── Portfolio & Occupancy ──────────────────────────────────────────────
  { slug: 'portfolio-overview', title: 'Portfolio Overview',       description: 'Units by type, occupancy, and annual asking rent.',                    Icon: FileBarChart, available: true,  group: 'portfolio' },
  { slug: 'occupancy',          title: 'Occupancy Report',         description: 'Units, occupied counts, and the rent roll per property.',              Icon: Building2,    available: true,  group: 'portfolio' },
  { slug: 'vacancy-analysis',   title: 'Vacancy Analysis',         description: 'Vacant units, asking rent at stake, and listing status.',              Icon: MapPin,       available: true,  group: 'portfolio' },
  // ── Leasing & Renewals ─────────────────────────────────────────────────
  { slug: 'renewal-forecast',   title: 'Renewal Details Per Year',  description: 'Every lease up for renewal in a year, month by month with annual rent — expand a month for the per-customer detail.',  Icon: RefreshCw,    available: true,  group: 'leasing' },
  { slug: 'renewal-vacancy',    title: 'Renewal Summary Per Year',  description: 'Per-property summary for a year — occupied units by renewal month + Vacant + Total units, straight from each unit\'s Available/Occupied status. Click Vacant to list the units.', Icon: Building2, available: true, group: 'leasing' },
  { slug: 'lease-expiry',       title: 'Lease Expiry Report',      description: 'Active contracts ending within 30 / 60 / 90 / 180 / 365 days.',       Icon: CalendarClock, available: true, group: 'leasing' },
  { slug: 'leases-by-year',     title: 'Leases by Year',           description: 'The full annual lease register — every lease in force during the selected year, with customer, unit, term dates, rent and status.', Icon: FileText, available: true, group: 'leasing' },
  { slug: 'new-leases-matrix',  title: 'New Leases by Month',       description: 'Property × month grid of leases commencing each month of the year (the matrix companion to Leasing Activity), with new-lease counts and annual rent per property.', Icon: CalendarClock, available: true, group: 'leasing' },
  { slug: 'leasing-activity',   title: 'Leasing Activity',         description: 'New leases per month, rent signed, and Contract Registration status.',                 Icon: CalendarClock, available: true, group: 'leasing' },
  { slug: 'lease-activity',     title: 'Lease Activity',      description: 'Month-by-month operations sheet — renewals due, new & renewal contracts, deposits, notices, customer & landlord online signatures, Contract Registration completed vs pending, move-outs, and average days to signature. Exportable to CSV in the executive format.', Icon: ScrollText, available: true, group: 'leasing' },
  { slug: 'operations-pipeline', title: 'Operations Pipeline', description: 'The Operations page as a printable report — every lead, new lease, renewal and termination in progress, stage by stage in workflow order, with customer and landlord signatures tracked separately (“on file” marks are not counted as signed).', Icon: ClipboardList, available: true,  group: 'leasing' },
  { slug: 'rent-vs-market',     title: 'Rent vs Market',           description: 'Current rent vs market benchmark per unit — uplift recoverable at renewal.', Icon: TrendingUp, available: true, group: 'leasing' },
  // ── Rent & Collections ─────────────────────────────────────────────────
  { slug: 'rent-collection',    title: 'Rent Collection (Rent Roll)', description: 'Collection matrix — customers down, months across, totals.',          Icon: BarChart2,    available: true,  group: 'collections' },
  { slug: 'receivables',        title: 'Receivables Summary',      description: 'Outstanding cheques aged 0-30 / 31-60 / 61-90 / 90+.',                Icon: Wallet,       available: true,  group: 'collections' },
  { slug: 'executive-cashflow', title: 'Executive Cashflow',        description: 'The month-by-month cashflow dashboard — rent expected vs received, pending and bounced, penalty income, and Net Income, with year-to-date totals. Anchored on the cheque date.', Icon: TrendingUp, available: true, group: 'collections' },
  { slug: 'cashflow-forecast',  title: 'Cash Inflow Forecast',     description: 'Post-dated cheques landing each month, plus the overdue backlog.',    Icon: Banknote,     available: true,  group: 'collections' },
  { slug: 'collection-rate',    title: 'Collection Rate Report',   description: 'Monthly collected vs scheduled rent, with collection %.',              Icon: BarChart2,    available: true,  group: 'collections' },
  { slug: 'cheque-register',    title: 'PDC / Cheque Register',    description: 'Every cheque with its status — pending, cleared, bounced, cancelled.', Icon: ScrollText,   available: true,  group: 'collections' },
  { slug: 'tenant-ledger',      title: 'Customer Ledger',          description: 'Per-customer rent collected, outstanding, and last payment.',          Icon: FileText,     available: true,  group: 'collections' },
  // ── Financial & Compliance ─────────────────────────────────────────────
  { slug: 'security-deposits',  title: 'Security Deposits Report', description: 'Deposit register with lifecycle — held, returned, forfeited.',         Icon: ShieldCheck,  available: true,  group: 'financial' },
  { slug: 'fee-taxation',       title: 'Fee & VAT (Taxation)',     description: 'Admin, Contract Registration & commission fees + rent VAT per year — net, VAT and gross.', Icon: ScrollText,  available: true, group: 'financial' },
  { slug: 'payment-grouping',   title: 'Payment Grouping (custom)', description: 'Build your own statement — drag payment types into categories you name; Contract Registration splits into DLD + service. Per-year, session-only.', Icon: Banknote, available: true, group: 'financial', rpOnly: true },
  { slug: 'income-statement',   title: 'Income Statement',         description: 'Revenue by stream — rent, admin, Contract Registration, deposits.',                    Icon: BarChart2,    available: false, group: 'financial' },
  // ── Data & Operations ──────────────────────────────────────────────────
  { slug: 'data-gaps',          title: 'Data Gaps & Exceptions',   description: 'A live worklist of missing data — contracts missing docs/payment plans/deposit, property & unit fields, customer KYC, and the landlord profile. Print to PDF.', Icon: AlertCircle, available: true, group: 'operations' },
  { slug: 'amc-vendor-spend',   title: 'AMC & Vendor Spend',       description: 'Vendor invoices and AMC contract costs.',                              Icon: Wrench,       available: false, group: 'operations' },
  { slug: 'manager-performance', title: 'Manager Performance Report', description: 'What each manager delivered — leads attended, contracts and renewals progressed, documents processed, and days active. Landlord-only report (managers don\u2019t see their own scorecard).', Icon: Users, available: true, group: 'operations', rpOnly: true },
  { slug: 'manager-operations', title: 'Manager Operations Report', description: 'The manager evaluation report — today / this week / this month compared to the previous period, day-by-day figures per manager, leases delivered, every stage as a clickable column, stage timing with customer & landlord wait separated, and what’s stuck right now. “On file” signatures are not counted. Landlord-only.', Icon: ListChecks, available: true, group: 'operations', rpOnly: true },
  // ── Missing Data Worklists (separate live report per entity) ────────────
  { slug: 'missing-properties', title: 'Missing Properties Data',   description: 'Properties missing location or descriptive fields — geo, floors, street, makani, plot, description.', Icon: MapPin,      available: true, group: 'missingdata' },
  { slug: 'missing-units',      title: 'Missing Units Data',        description: 'Units missing pricing, fees, specs or media — rent, deposit, admin/Contract Registration/commission, beds/baths, size, floor plan, images.', Icon: Building2,  available: true, group: 'missingdata' },
  { slug: 'missing-customers',  title: 'Missing Customers Data',    description: 'Customers missing KYC — Emirates ID, ID document, nationality, DOB, gender, phone, trade licence.', Icon: Users,       available: true, group: 'missingdata' },
  { slug: 'missing-contracts',  title: 'Missing Contract Data',     description: 'Contracts missing a document, payment plan, security deposit or Contract Registration number — active & pending first.', Icon: FileText,    available: true, group: 'missingdata' },
  { slug: 'missing-landlord',   title: 'Missing Landlord Profile Data', description: 'Landlord profile & configuration still unset — bank, trade licence, title-deed & EID docs, renewal %, preferred days, POA.', Icon: ShieldCheck, available: true, group: 'missingdata' },
];

