/**
 * Shared report catalog — group structure + tiles for BOTH report hubs
 * (RP /rental-provider/dashboard/reports and the manager portal). One list so
 * the portals can't drift.
 */
import {
  FileText, BarChart2, Building2, CalendarClock,
  RefreshCw, MapPin, Wallet, ShieldCheck, Users, FileBarChart, ScrollText,
  Banknote, TrendingUp, ListChecks, CalendarDays, Activity, ClipboardCheck, ReceiptText,
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

/**
 * How a money surface measures — its lease SCOPE, its PERIOD basis and its cheque
 * STATUS rule. Five surfaces read the same `payments` ledger and legitimately
 * answer different questions; without this stated on the page, any two figures
 * that differ read as a bug and someone spends a morning proving they aren't.
 *
 * ONE source of wording, rendered by the report shell, by Payment Grouping and by
 * the Payments page, so the three can never describe the same rule differently.
 * `differsFrom` names the report a reader is most likely to be comparing against
 * and says why the two will not tie.
 */
export interface ReportBasis {
  scope: string;
  period: string;
  status: string;
  differsFrom?: string;
}
export const REPORT_BASIS: Record<string, ReportBasis> = {
  'rent-receivable': {
    scope: 'One earning lease per occupied unit',
    period: 'No calendar window — earliest to latest cheque',
    status: 'Cancelled excluded; a made-good bounce reported beside the total, never inside it',
    differsFrom: 'Deliberately drops prior-term cheques a unit was re-let over, so it will read lower than Fee & VAT for the same months.',
  },
  'security-deposits': {
    scope: 'Every lease with a deposit, plus deposits whose lease was deleted',
    period: 'None — the whole book as it stands today (the ledger records no collection date)',
    status: 'Lifecycle states — held, returned, partial, forfeited',
    differsFrom: 'Held now already contains Pending settlement; the two tiles are not additive.',
  },
  'fee-taxation': {
    scope: 'Every contract, no per-unit dedupe — VAT-applicable only by default',
    period: 'The period each payment falls DUE (its tax point)',
    status: 'Cancelled and made-good bounces excluded and reported separately',
    differsFrom: 'Payment Grouping lists every contract. Switch this report to "All contracts" to tie the two.',
  },
  'payment-grouping': {
    scope: 'Every contract and every payment type',
    period: 'The period each payment falls DUE (its tax point)',
    status: 'Cancelled and made-good bounces excluded and reported separately',
    differsFrom: 'Fee & VAT shows only VAT-applicable contracts by default; set it to "All contracts" to compare.',
  },
  payments: {
    scope: 'Every contract and every payment type — the full ledger',
    period: 'No window — the whole book, filtered on screen',
    status: 'Every row is LISTED; the subtotals count only what was collectible',
    differsFrom: 'The only surface that shows cancelled and replaced cheques as lines. Its subtotals match Payment Grouping.',
  },
};

/** The basis line, rendered identically wherever a money surface is shown.
 *  Renders nothing for a slug with no entry, so adding it to a page is safe. */
export function BasisNote({ slug, className = '' }: { slug: string; className?: string }) {
  const b = REPORT_BASIS[slug];
  if (!b) return null;
  return (
    <div className={`text-xs text-[#6b6860] ${className}`}>
      <p>
        <span className="font-medium text-[#3d3b35]">How this is measured:</span>{' '}
        {b.scope} · {b.period} · {b.status}
      </p>
      {b.differsFrom && <p className="mt-0.5 italic">{b.differsFrom}</p>}
    </div>
  );
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
  { slug: 'contract-status',    title: 'Contract Status - Monthly', description: 'The monthly contract status sheet for a whole year — every month, the contracts turning over that month with property, customer, unit, term, annual rent and cheques, each marked Renewed / For signature / Pending / Move-out, plus the month\'s signed-agreement and Contract Registration counts.', Icon: ClipboardCheck, available: true, group: 'leasing' },
  { slug: 'payment-record',     title: 'Payment Record - Monthly', description: 'The monthly collections handover sheet — every lease commencing in a month with each cheque taken for it, whatever date it falls due, split into rent, admin, registration, deposit, commission, third party and service charge.', Icon: ReceiptText, available: true, group: 'collections' },
  { slug: 'leases-by-year',     title: 'Leases - Monthly',         description: 'The annual lease register grouped by commencement month — expand a month to see the leases that began then, with customer, unit, term dates, rent and status.', Icon: FileText, available: true, group: 'leasing' },
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
  { slug: 'rent-receivable',    title: 'Cash Management', description: 'Every occupied unit with all its rent payments month by month \u2014 no calendar cut, so a tenancy is never split across two years. Bounced cheques that were made good are kept out of the totals.', Icon: BarChart2,    available: true,  group: 'collections' },
  { slug: 'cheques-management', title: 'Cheques Management', description: 'Every cheque you are holding \u2014 one row per occupied unit, grouped by property, with each cheque\'s due date and a month-by-month grid. No calendar cut; a bounce that was made good is kept out of the value.', Icon: CalendarDays, available: true,  group: 'collections' },
  { slug: 'executive-cashflow', title: 'Executive Cashflow',        description: 'The month-by-month cashflow dashboard — the selected year of Cash Management read down the months: rent expected (received + pending) vs collected, and the penalty income, with full-year totals. Anchored on the cheque date, same earning leases; a bounce is reported beside Expected, never inside it.', Icon: TrendingUp, available: true, group: 'collections' },
  // ── Financial & Compliance ─────────────────────────────────────────────
  { slug: 'security-deposits',  title: 'Security Deposits Report', description: 'Deposit register with lifecycle — held, returned, forfeited.',         Icon: ShieldCheck,  available: true,  group: 'financial' },
  { slug: 'fee-taxation',       title: 'Fee & VAT (Taxation)',     description: 'Admin, Contract Registration & commission fees, rent VAT and third-party pass-throughs per year — net, VAT and gross.', Icon: ScrollText,  available: true, group: 'financial' },
  { slug: 'payment-grouping',   title: 'Payment Grouping (custom)', description: 'Build your own statement — drag payment types into categories you name; Contract Registration splits into DLD + service. Per-year, session-only.', Icon: Banknote, available: true, group: 'financial', rpOnly: true },
  // ── Manager activity ───────────────────────────────────────────────────
  { slug: 'manager-operations', title: 'Manager Operations Report', description: 'The manager evaluation report — today / this week / this month compared to the previous period, day-by-day figures per manager, leases delivered, every stage as a clickable column, stage timing with customer & landlord wait separated, and what’s stuck right now. “On file” signatures are not counted. Landlord-only.', Icon: ListChecks, available: true, group: 'operations', rpOnly: true },
  { slug: 'activity-log', title: 'Activity Log', description: 'Every recorded action in the shape an owner reads it — when, who (person and role, and who they acted for), what, where (lease · unit · property · customer), what changed before → after, and why. Includes a coverage matrix of every catalogued action and how often each line of the record can actually be filled. Anything never captured says so explicitly instead of showing a bare verb.', Icon: Activity, available: true, group: 'operations', rpOnly: true },
  { slug: 'manager-activity-counters', title: 'Activity by Side', description: 'Each step of the journey month by month — KYC completed, payment plan issued, cheques collected, registration issued and pending, utility accepted, move-in issued, manager signature, renewal notices, move-out initiated and completed, bills cleared, settlement issued and closed. Three sheets, one per side: your team, the customer, the landlord — a step is counted once, under whoever performed it. Every figure counts records once; click any number for the records behind that step in that month. Landlord-only.', Icon: ClipboardCheck, available: true, group: 'operations', rpOnly: true },
  { slug: 'manager-activity-performance', title: 'Manager Activity Performance', description: 'The Operations page read per person, from the activity log — what each of them delivered, days worked against days idle, and every lane of the four pipelines as a person-by-lane matrix. Click a cell for the lane’s whole action catalogue and the actions behind the number. Waiting time is split by whose side it was on, so a customer’s delay is never scored against a manager. Landlord-only.', Icon: ClipboardCheck, available: true, group: 'operations', rpOnly: true },
  { slug: 'operations-by-stage', title: 'Operations by Stage', description: 'Records each manager progressed, stage by stage — the operations pipeline matrix on its own. Click any number to see the records behind it with their history. Managers can open it to see their own activity and pipeline. “On file” signatures are not counted.', Icon: ListChecks, available: true, group: 'operations', hidden: true },
];

