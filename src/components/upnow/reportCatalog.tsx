/**
 * Shared report catalog — group structure + tiles for BOTH report hubs
 * (RP /rental-provider/dashboard/reports and the manager portal). One list so
 * the portals can't drift.
 */
import {
  FileText, BarChart2, Building2, CalendarClock,
  RefreshCw, MapPin, Wallet, ShieldCheck, Users, FileBarChart, ScrollText,
  Banknote, TrendingUp, ListChecks, CalendarDays, Activity, ClipboardCheck, LogOut, Scale, Ban,
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
    scope: 'One earning lease per occupied unit — every payment type on it (deposits are held money, not payments: own tab, own totals)',
    period: 'No window — the whole book; the year filter buckets each payment by the period it falls DUE',
    status: 'Every row is LISTED; subtotals exclude cancelled and bounced cheques, made good or not',
    differsFrom: 'Ties to Cash Management. Payment Grouping and Fee & VAT read every contract and still count an unreplaced bounce (it is a supply for VAT), so they run higher.',
  },
};

/** The basis line, rendered identically wherever a money surface is shown.
 *  Renders nothing for a slug with no entry, so adding it to a page is safe. */
export function BasisNote({ slug, className = '' }: { slug: string; className?: string }) {
  const b = REPORT_BASIS[slug];
  if (!b) return null;
  return (
    <div className={`text-xs text-[#5f6b63] ${className}`}>
      <p>
        <span className="font-medium text-[#46534c]">How this is measured:</span>{' '}
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
  { slug: 'market-comparison',  title: 'Market Comparison',  description: 'Each layout against what the market asks for the same area, type and bedrooms — Bayut, Property Finder, Dubizzle and government data side by side, the market average, and whether you sit below, at or above it.', Icon: Scale, available: true, group: 'portfolio' },
  // ── Leasing Activity ───────────────────────────────────────────────────
  { slug: 'leasing-activity',   title: 'Contract Registration Activity', description: 'New leases per month, rent signed, and Contract Registration status.',                 Icon: CalendarClock, available: true, group: 'leasing', hidden: true },
  { slug: 'contract-status',    title: 'Contract Status - Monthly', description: 'The monthly contract status sheet for a whole year — every month, the contracts turning over that month with property, customer, unit, term, annual rent and cheques, each marked Renewed / For signature / Pending / Move-out, plus the month\'s signed-agreement and Contract Registration counts.', Icon: ClipboardCheck, available: true, group: 'leasing', hidden: true },
  { slug: 'leases-by-year',     title: 'Leases - Monthly',         description: 'The annual lease register grouped by commencement month — expand a month to see the leases that began then, with customer, unit, term dates, rent and status.', Icon: FileText, available: true, group: 'leasing' },
  { slug: 'new-leases-matrix',  title: 'Lease Summary - Yearly',       description: 'Property × month grid of leases commencing each month of the year (the matrix companion to Contract Registration Activity), with new-lease counts and annual rent per property.', Icon: CalendarClock, available: true, group: 'leasing' },
  { slug: 'lease-revenue-by-year', title: 'Lease Revenue by Year', description: 'Each lease\'s rent allocated to the calendar years its term actually covers — driven by the lease period, not the signing date. One row per lease with a column per year, a Summary-by-Year rollup, renewal chains grouped together, and a 90-day expiry flag for chasing renewals. Exportable to CSV.', Icon: TrendingUp, available: true, group: 'leasing', hidden: true },
  { slug: 'lease-activity',     title: 'Lease Activity',      description: 'Month-by-month operations sheet — renewals due, new & renewal contracts, deposits, notices, customer & landlord online signatures, Contract Registration completed vs pending, move-outs, and average days to signature. Exportable to CSV in the executive format.', Icon: ScrollText, available: true, group: 'leasing', hidden: true },
  { slug: 'leasing-funnel',     title: 'Leasing Funnel by Manager',      description: 'The leasing journey as a month-by-month funnel — how many contracts reached each stage: Lead Received, Viewing Done, KYC Verified, Deposit Collected, Renewal Notice Sent, Customer & Landlord Signed, Contract Registration pending vs done, Activated, Move-out Inspection and Settlement Signed. Exportable to CSV.', Icon: ListChecks, available: true, group: 'operations', hidden: true },
  // ── Renewals & Expiry ──────────────────────────────────────────────────
  { slug: 'lease-expiry',       title: 'Upcoming Renewals',        description: 'Renewals this month and the next 30 / 60 / 90 / 180 / 365 days, counted the Renewal Plan way and grouped by renewal month.', Icon: CalendarClock, available: true, group: 'renewals' },
  { slug: 'renewal-forecast',   title: 'Renewal Plan - Monthly',    description: 'Every lease up for renewal in a year, month by month with annual rent — expand a month for the per-customer detail.',  Icon: RefreshCw,    available: true,  group: 'renewals' },
  { slug: 'renewal-vacancy',    title: 'Renewal Plan - Yearly',     description: 'Per-property summary for a year — occupied units by renewal month + Vacant + Total units, straight from each unit\'s Available/Occupied status. A unit whose termination has been accepted counts as Vacant, marked "Terminating" until move-out. Click Vacant to list the units.', Icon: Building2, available: true, group: 'renewals' },
  { slug: 'rent-vs-market',     title: 'Rent vs Asking',           description: 'Current contracted rent vs the unit’s asking price — uplift recoverable at renewal.', Icon: TrendingUp, available: true, group: 'renewals' },
  { slug: 'move-out-reasons',   title: 'Move-out Reasons',         description: 'Why customers left — the reason recorded at move-out, counted. Reasons biggest-first, the same exits read by who drove them (customer-driven / landlord-driven / breach), how each tenancy ended, the month they left, and the leases behind every figure with length of stay and the annual rent that walked. A move-out is an accepted termination, a renewal declined to vacate, or a term that ran out with nothing continuing it — voided leases and tenancies that simply renewed are excluded. Move-outs with no recorded reason stay in the totals as “Not recorded” so no percentage is inflated. Exportable to CSV.', Icon: LogOut, available: true, group: 'renewals', hidden: true },
  // ── Rent & Collections ─────────────────────────────────────────────────
  { slug: 'rent-receivable',    title: 'Cash Management', description: 'Every occupied unit with all its rent payments month by month \u2014 no calendar cut, so a tenancy is never split across two years. Bounced cheques that were made good are kept out of the totals.', Icon: BarChart2,    available: true,  group: 'collections' },
  { slug: 'cheques-management', title: 'Cheques Management', description: 'Every cheque you are holding \u2014 one row per occupied unit, grouped by property, with each cheque\'s due date and a month-by-month grid. No calendar cut; a bounce that was made good is kept out of the value.', Icon: CalendarDays, available: true,  group: 'collections' },
  { slug: 'bounced-cheques',    title: 'Bounced Cheques', description: 'The statement of every rent cheque that bounced in a year \u2014 what came back against it and whether the money is in the bank. Filter to Pending, Cleared or All; bounce fees beside each cheque.', Icon: Ban, available: true, group: 'collections' },
  { slug: 'executive-cashflow', title: 'Executive Cashflow',        description: 'The month-by-month cashflow dashboard — the selected year of Cash Management read down the months: rent expected (received + pending) vs collected, and the penalty income, with full-year totals. Anchored on the cheque date, same earning leases; a bounce is reported beside Expected, never inside it.', Icon: TrendingUp, available: true, group: 'collections' },
  // ── Financial & Compliance ─────────────────────────────────────────────
  { slug: 'security-deposits',  title: 'Security Deposits Report', description: 'Deposit register with lifecycle — held, returned, forfeited.',         Icon: ShieldCheck,  available: true,  group: 'financial' },
  { slug: 'fee-taxation',       title: 'Fee & VAT (Taxation)',     description: 'Admin, Contract Registration & commission fees, rent VAT and third-party pass-throughs per year — net, VAT and gross.', Icon: ScrollText,  available: true, group: 'financial' },
  { slug: 'payment-grouping',   title: 'Payment Grouping (custom)', description: 'Build your own statement — drag payment types into categories you name; Contract Registration splits into DLD + service. Per-year, session-only.', Icon: Banknote, available: true, group: 'financial', rpOnly: true },
  // ── Manager activity ───────────────────────────────────────────────────
  { slug: 'manager-operations', title: 'Manager Operations Report', description: 'The manager evaluation report — today / this week / this month compared to the previous period, day-by-day figures per manager, leases delivered, every stage as a clickable column, stage timing with customer & landlord wait separated, and what’s stuck right now. “On file” signatures are not counted. Landlord-only.', Icon: ListChecks, available: true, group: 'operations', rpOnly: true, hidden: true },
  { slug: 'activity-log', title: 'Activity Log', description: 'Every recorded action in the shape an owner reads it — when, who (person and role, and who they acted for), what, where (lease · unit · property · customer), what changed before → after, and why. Includes a coverage matrix of every catalogued action and how often each line of the record can actually be filled. Anything never captured says so explicitly instead of showing a bare verb.', Icon: Activity, available: true, group: 'operations', rpOnly: true },
  { slug: 'manager-activity-counters', title: 'Activity by Side', description: 'Each step of the journey month by month — KYC completed, payment plan issued, cheques collected, registration issued and pending, utility accepted, move-in issued, manager signature, renewal notices, move-out initiated and completed, bills cleared, settlement issued and closed. Three sheets, one per side: your team, the customer, the landlord — a step is counted once, under whoever performed it. Every figure counts records once; click any number for the records behind that step in that month. Landlord-only.', Icon: ClipboardCheck, available: true, group: 'operations', rpOnly: true },
  { slug: 'manager-activity-performance', title: 'Manager Activity Performance', description: 'The Operations page read per person, from the activity log — what each of them delivered, days worked against days idle, and every lane of the four pipelines as a person-by-lane matrix. Click a cell for the lane’s whole action catalogue and the actions behind the number. Waiting time is split by whose side it was on, so a customer’s delay is never scored against a manager. Landlord-only.', Icon: ClipboardCheck, available: true, group: 'operations', rpOnly: true, hidden: true },
  { slug: 'operation-plan', title: 'Operation Management Plan', description: 'The ops team’s plan sheet read straight off the system — one section per kind of work (units, leads, leases, payments, maintenance, vendors, Ejari, legal…), a row per matter: what the system holds, the stage it is at, what that stage calls for, and who handles it. Exports in the team’s own sheet format.', Icon: ListChecks, available: true, group: 'operations' },
  { slug: 'operations-by-stage', title: 'Operations by Stage', description: 'Records each manager progressed, stage by stage — the operations pipeline matrix on its own. Click any number to see the records behind it with their history. Managers can open it to see their own activity and pipeline. “On file” signatures are not counted.', Icon: ListChecks, available: true, group: 'operations', hidden: true },
];

