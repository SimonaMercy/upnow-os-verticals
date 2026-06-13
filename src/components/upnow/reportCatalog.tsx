/**
 * Shared report catalog — group structure + tiles for BOTH report hubs
 * (RP /rental-provider/dashboard/reports and the manager portal). One list so
 * the portals can't drift.
 */
import {
  FileText, BarChart2, Building2, AlertCircle, CalendarClock,
  RefreshCw, MapPin, Wallet, ShieldCheck, Users, Wrench, FileBarChart, ScrollText,
  Banknote, TrendingUp,
} from 'lucide-react';

export type GroupKey = 'portfolio' | 'leasing' | 'collections' | 'financial' | 'operations';

export interface ReportTile {
  slug: string;
  title: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  available: boolean;
  group: GroupKey;
}

/** Section order + headers for the grouped hub. Coming-soon reports sit
 *  greyed-out inside their natural group rather than in a separate dump. */
export const GROUPS: { key: GroupKey; title: string; blurb: string; Icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { key: 'portfolio',   title: 'Portfolio & Occupancy',  blurb: 'What you own and how full it is.',                      Icon: FileBarChart },
  { key: 'leasing',     title: 'Leasing & Renewals',     blurb: 'Tenancy lifecycle — expiries, renewals, new leases.',   Icon: RefreshCw },
  { key: 'collections', title: 'Rent & Collections',     blurb: 'Money in — rent roll, cheques, receivables, cashflow.', Icon: Wallet },
  { key: 'financial',   title: 'Financial & Compliance', blurb: 'Deposits, fees, VAT and statements.',                   Icon: ScrollText },
  { key: 'operations',  title: 'Data & Operations',      blurb: 'Data quality, vendors and team.',                       Icon: Wrench },
];

export const REPORT_TILES: ReportTile[] = [
  // ── Portfolio & Occupancy ──────────────────────────────────────────────
  { slug: 'portfolio-overview', title: 'Portfolio Overview',       description: 'Units by type, occupancy, and annual asking rent.',                    Icon: FileBarChart, available: true,  group: 'portfolio' },
  { slug: 'occupancy',          title: 'Occupancy Report',         description: 'Units, occupied counts, and the rent roll per property.',              Icon: Building2,    available: true,  group: 'portfolio' },
  { slug: 'vacancy-analysis',   title: 'Vacancy Analysis',         description: 'Vacant units, asking rent at stake, and listing status.',              Icon: MapPin,       available: true,  group: 'portfolio' },
  // ── Leasing & Renewals ─────────────────────────────────────────────────
  { slug: 'renewal-forecast',   title: 'Renewal Forecast',         description: 'Leases coming up for renewal each month, with annual rent at stake.',  Icon: RefreshCw,    available: true,  group: 'leasing' },
  { slug: 'lease-expiry',       title: 'Lease Expiry Report',      description: 'Active contracts ending within 30 / 60 / 90 / 180 / 365 days.',       Icon: CalendarClock, available: true, group: 'leasing' },
  { slug: 'leasing-activity',   title: 'Leasing Activity',         description: 'New leases per month, rent signed, and Ejari status.',                 Icon: CalendarClock, available: true, group: 'leasing' },
  { slug: 'rent-vs-market',     title: 'Rent vs Market',           description: 'Current rent vs market benchmark per unit — uplift recoverable at renewal.', Icon: TrendingUp, available: true, group: 'leasing' },
  // ── Rent & Collections ─────────────────────────────────────────────────
  { slug: 'rent-collection',    title: 'Rent Collection (Rent Roll)', description: 'Collection matrix — customers down, months across, totals.',          Icon: BarChart2,    available: true,  group: 'collections' },
  { slug: 'receivables',        title: 'Receivables Summary',      description: 'Outstanding cheques aged 0-30 / 31-60 / 61-90 / 90+.',                Icon: Wallet,       available: true,  group: 'collections' },
  { slug: 'cashflow-forecast',  title: 'Cash Inflow Forecast',     description: 'Post-dated cheques landing each month, plus the overdue backlog.',    Icon: Banknote,     available: true,  group: 'collections' },
  { slug: 'collection-rate',    title: 'Collection Rate Report',   description: 'Monthly collected vs scheduled rent, with collection %.',              Icon: BarChart2,    available: true,  group: 'collections' },
  { slug: 'cheque-register',    title: 'PDC / Cheque Register',    description: 'Every cheque with its status — pending, cleared, bounced, cancelled.', Icon: ScrollText,   available: true,  group: 'collections' },
  { slug: 'tenant-ledger',      title: 'Customer Ledger',          description: 'Per-customer rent collected, outstanding, and last payment.',          Icon: FileText,     available: true,  group: 'collections' },
  // ── Financial & Compliance ─────────────────────────────────────────────
  { slug: 'security-deposits',  title: 'Security Deposits Report', description: 'Deposit register with lifecycle — held, returned, forfeited.',         Icon: ShieldCheck,  available: true,  group: 'financial' },
  { slug: 'fee-taxation',       title: 'Fee & VAT (Taxation)',     description: 'Admin, ejari & commission fees + rent VAT per year — net, VAT and gross.', Icon: ScrollText,  available: true, group: 'financial' },
  { slug: 'income-statement',   title: 'Income Statement',         description: 'Revenue by stream — rent, admin, ejari, deposits.',                    Icon: BarChart2,    available: false, group: 'financial' },
  // ── Data & Operations ──────────────────────────────────────────────────
  { slug: 'data-gaps',          title: 'Data Gaps & Exceptions',   description: 'Active leases missing a deposit, KYC gaps, the renewal backlog, and units missing details.', Icon: AlertCircle, available: true, group: 'operations' },
  { slug: 'amc-vendor-spend',   title: 'AMC & Vendor Spend',       description: 'Vendor invoices and AMC contract costs.',                              Icon: Wrench,       available: false, group: 'operations' },
  { slug: 'manager-performance', title: 'Manager Performance Report', description: 'Per-asset-manager activity and deal velocity.',                     Icon: Users,        available: false, group: 'operations' },
];

