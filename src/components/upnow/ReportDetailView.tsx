/**
 * Shared report detail view — interactive table with sort/filter, CSV download
 * and print-friendly PDF, for EVERY report slug. Used by BOTH portals:
 *   RP:      /rental-provider/dashboard/reports/[slug]   (endpointBase /api/reports)
 *   Manager: /dashboard/manager/reports?rp=N&slug=x      (endpointBase /api/manager/reports, extraQuery rp=N)
 * One component so the two portals can never drift again.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Search, Download, Printer, Loader2, FileSpreadsheet,
  BarChart2, AlertCircle, TrendingUp, TrendingDown, Minus, ChevronRight, X, ExternalLink,
  Building2, Check, ChevronDown, Info,
} from 'lucide-react';
import { apiPatch } from '@/lib/api';
import { getReportsYear, useReportsYear, yearToRange, yearForMatrix } from '@/components/upnow/reportsYear';
import { ManagerPerformanceCharts, LeaseActivityCharts, ExecutiveCashflowCharts } from '@/components/upnow/ReportCharts';
import { DateRangePicker } from '@/components/upnow/DateRangePicker';
import { MemberActivityView, type MemberRow } from '@/components/upnow/MemberActivityView';

type ReportSlug = 'portfolio' | 'lease-expiry' | 'leases-by-year' | 'renewal-pipeline' | 'renewal-forecast' | 'security-deposits' | 'executive-cashflow' | 'portfolio-overview' | 'vacancy-analysis' | 'leasing-activity' | 'lease-activity' | 'manager-performance' | 'new-leases-matrix' | 'rent-collection' | 'cheques-management' | 'renewal-vacancy' | 'fee-taxation' | 'rent-vs-market';

interface DrilldownSpec {
  /** Row field holding the array of child items. */
  childKey: string;
  /** Child field to offer as filter chips in the modal (e.g. 'kind'). */
  filterKey?: string;
  /** Row field used for the modal title (e.g. the month label). */
  titleKey: string;
  /** CSV header for the group column (defaults to 'Month'). */
  titleLabel?: string;
  /** Plural noun for the count, e.g. "leases". */
  countLabel: string;
  columns: Column[];
  /** Item field whose value is a contract id → row links to the contract. */
  contractIdKey?: string;
}

interface ReportDef {
  title: string;
  /** One plain-language line under the title. When absent, only the ⓘ shows. */
  tagline?: string;
  description: string;
  endpoint: string;
  columns: Column[];
  totals: TotalSpec[];
  /** Optional control rendered above the table (e.g. window-days for lease expiry). */
  controlKey?: 'leaseExpiryWindow' | 'dateRange' | 'year' | 'yearRange' | 'forecastMonths';
  /** When set, table rows expand into a modal listing their child items. */
  drilldown?: DrilldownSpec;
  /**
   * 'table' (default) = one flat table. 'grouped' = render each row as a
   * section (using its summary columns as the header) with its drilldown
   * children listed inline beneath — everything on one page, no modal.
   */
  layout?: 'table' | 'grouped' | 'matrix' | 'countMatrix' | 'chequeMatrix';
  /** Optional caution banner shown above the report (e.g. data-quality notes). */
  dataNote?: string;
  /** When set, render the Property + leasing-model (direct/sub/management)
   *  multi-select filters. The backend returns a `buildings` option list and
   *  honours `buildings=` / `leaseTypes=` query params. Enabled on every report
   *  that supports scoping by property + lease type. */
  buildingLeaseFilter?: boolean;
  /** Fee & VAT only — the extra Overall/Detailed view toggle + Year/Quarter
   *  grouping controls (and the per-contract detail table). Kept separate from
   *  `buildingLeaseFilter` so the shared Property / Lease-type filter can be
   *  turned on for a report without dragging in the fee-taxation-specific UI. */
  feeTaxationControls?: boolean;
  /** When set, render a Unit type dropdown in the filter bar. The backend returns
   *  a `unitTypes` option list and honours a `unitType=` query param. */
  unitTypeFilter?: boolean;
  /** When set, render an Active · Expired · All lease-status segmented control.
   *  The backend honours a `status=active|expired|all` query param (default all). */
  leaseStatusFilter?: boolean;
  /** When set, render an All · Occupied · Vacant occupancy dropdown. The backend
   *  honours an `occupancy=occupied|vacant|all` query param (default all).
   *  Occupied narrows Annual Rent to passing/in-place rent; Vacant to hold-over. */
  occupancyFilter?: boolean;
  /** Turn one column of a flat table into a deep link to the record the row
   *  represents — no drill-down needed. `idKey` is the row field holding the
   *  target id; the cell in `colKey` becomes the link. target 'unit' links are
   *  only rendered when a `unitsBase` is supplied (the manager portal has no
   *  unit detail route, so they'd 404 there). */
  rowLink?: { idKey: string; colKey: string; target?: 'contract' | 'unit' };
  /** countMatrix only: make each month cell clickable → a popup of the records
   *  behind that property×month count. Items come from row[itemsKey][cellIndex]
   *  (itemsKey defaults 'cellItems'), rendered with these columns. */
  cellDrill?: { itemsKey?: string; countLabel: string; contractIdKey?: string; columns: Column[] };
  /** countMatrix only: the trailing summary columns after the 12 month cells,
   *  read from each row (and from `totals` for the footer/tiles) by `key`. When
   *  omitted the matrix keeps its renewal-vacancy default (Renewals · Vacant ·
   *  Total units, with the clickable vacant drill-down). */
  matrixTrailing?: { key: string; label: string; type?: 'number' | 'aed' }[];
}

/** A vacant unit, listed when a Vacant cell in the renewal-details matrix is clicked. */
interface VacantUnit { unitId: number; label: string; unitType: string | null; rentFils: number; }

/** A building option for the fee-taxation building multi-select (from the API). */
interface BuildingOption { id: number; name: string; leasingType: 'direct' | 'sub' | 'management'; contracts: number; }
type LeaseType = 'direct' | 'sub' | 'management';
const ALL_LEASE_TYPES: LeaseType[] = ['direct', 'sub', 'management'];
const LEASE_TYPE_LABELS: Record<LeaseType, string> = { direct: 'Direct', sub: 'Sub-lease', management: 'Management' };
/** Prettify a raw unit_type token (e.g. 'retail_shop' → 'Retail Shop'). */
const prettyUnitType = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  type?: 'aed' | 'date' | 'number' | 'bucket' | 'stage' | 'rate' | 'delta';
  width?: string;
  /** Show this column even when every value is 0 — its 0 is meaningful (e.g. "Days left"). */
  keep?: boolean;
}

interface TotalSpec {
  key: string;
  label: string;
  type?: 'aed' | 'number' | 'rate';
  /** Show this tile even when zero — for totals whose 0 IS the signal (e.g. arrears). */
  keep?: boolean;
}

/** ⓘ — explanations live behind this, keeping pages executive-clean. */
function InfoTip({ text, align = 'left' }: { text: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex print:hidden">
      <button
        type="button"
        aria-label="About this"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="text-[#9b9890] hover:text-[#2e9f82] transition-colors align-middle">
        <Info size={15} />
      </button>
      {open && (
        <span
          className={`absolute z-40 top-full mt-2 ${align === 'right' ? 'right-0' : 'left-0'} w-80 max-w-[80vw] bg-white border border-[#e3e0d9] rounded-xl shadow-xl p-3.5 text-xs leading-relaxed text-[#4a4742] whitespace-normal`}
          style={{ boxShadow: '0 12px 32px rgba(20,18,15,.16)' }}>
          {text}
        </span>
      )}
    </span>
  );
}

const RENEWAL_FORECAST_DEF: ReportDef = {
  title: 'Renewal Plan - Monthly',
  description: 'The detailed companion to Renewal Plan - Yearly — the same renewals for the selected year, but month by month with the individual leases. Each lease is bucketed by the month its renewal falls due (the day after the term ends, so a lease ending 31 Jul renews in August); a unit that already renewed earlier in the year also shows in the month its new term began (stage Renewed). Expand a month to see every lease by customer. Pick the year above — it matches the year filter on Renewal Plan - Yearly.',
  endpoint: '/api/reports/renewal-forecast',
  buildingLeaseFilter: true,
  layout: 'grouped',
  controlKey: 'year',
  columns: [
    { key: 'monthLabel', label: 'Month' },
    { key: 'leases', label: 'Leases up for renewal', align: 'right', type: 'number' },
    { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
    { key: 'inProgress', label: 'In progress', align: 'right', type: 'number' },
    { key: 'notStarted', label: 'Not started', align: 'right', type: 'number' },
  ],
  totals: [
    { key: 'totalLeases', label: 'Renewals', type: 'number', keep: true },
    { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
    { key: 'inProgress', label: 'In progress', type: 'number' },
    { key: 'notStarted', label: 'Not started', type: 'number' },
    { key: 'renewed', label: 'Renewed', type: 'number', keep: true },
  ],
  drilldown: {
    childKey: 'items',
    titleKey: 'monthLabel',
    countLabel: 'leases',
    contractIdKey: 'contractId',
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'endDate', label: 'Lease ends', type: 'date' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      { key: 'stage', label: 'Renewal', type: 'stage' },
    ],
  },
};

// Shown on cheque/collection reports: the cheque figures are real (extracted
// from the scanned cheque copies), but clearance is inferred from the due date.
const NEEDS_CHEQUE_DATA = 'Cheque numbers, dates and amounts are from your scanned cheques. A cheque shows as collected once its due date has passed — flag any bounced cheque, and reconcile against bank statements for exact clearance. A few contracts with incomplete scans still use the rent schedule.';

const REPORTS: Record<ReportSlug, ReportDef> = {
  portfolio: {
    title: 'Portfolio',
    description: 'Snapshot of how each property is performing — units, occupied counts, and rent. "Market Rent" is the asking rent set on the units (units.rental_price) across every unit — a live benchmark. "Annual Rent" is the contracted rent on the books from the tenancy contracts — the latest effective lease on every unit, including currently vacant units where a prior term exists. Use the Occupancy filter to reshape the Annual Rent figure only (rows and unit counts stay whole): Occupied = passing/in-place rent on leased units, Vacant = hold-over value on empty units, All = the full contracted rent roll. Market Rent, Annual Rent and the unit counts are all a live snapshot of today.',
    endpoint: '/api/reports/occupancy',
    buildingLeaseFilter: true,
    occupancyFilter: true,
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'community', label: 'Community' },
      { key: 'emirate', label: 'Emirate' },
      { key: 'totalUnits', label: 'Units', align: 'right', type: 'number' },
      { key: 'occupiedUnits', label: 'Occupied', align: 'right', type: 'number' },
      { key: 'vacantUnits', label: 'Vacant', align: 'right', type: 'number' },
      { key: 'maintenanceUnits', label: 'Maintenance', align: 'right', type: 'number' },
      { key: 'reservedUnits', label: 'Reserved', align: 'right', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', align: 'right', type: 'rate' },
      { key: 'marketRentFils', label: 'Market Rent', align: 'right', type: 'aed' },
      { key: 'annualRentFils', label: 'Annual Rent', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'properties', label: 'Properties', type: 'number' },
      { key: 'units', label: 'Units', type: 'number' },
      { key: 'occupied', label: 'Occupied', type: 'number' },
      { key: 'vacant', label: 'Vacant', type: 'number' },
      { key: 'maintenance', label: 'Maintenance', type: 'number' },
      { key: 'reserved', label: 'Reserved', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', type: 'rate' },
      { key: 'marketRentFils', label: 'Market Rent', type: 'aed' },
      { key: 'annualRentFils', label: 'Annual Rent', type: 'aed' },
    ],
    // Click a property to list its units with live status + rent.
    drilldown: {
      childKey: 'units',
      titleKey: 'buildingName',
      countLabel: 'units',
      columns: [
        { key: 'unitLabel', label: 'Unit' },
        { key: 'unitType', label: 'Type', type: 'stage' },
        { key: 'availability', label: 'Status', type: 'stage' },
        { key: 'marketRentFils', label: 'Market Rent', align: 'right', type: 'aed' },
        { key: 'annualRentFils', label: 'Annual Rent', align: 'right', type: 'aed' },
      ],
    },
  },
  'lease-expiry': {
    title: 'Upcoming Renewals',
    description: 'Active leases whose term is ending within the chosen window — grouped by the month they come up for renewal. Each row is a month; expand it to see the individual leases and their renewal state. Adjust the window above.',
    endpoint: '/api/reports/lease-expiry',
    buildingLeaseFilter: true,
    layout: 'grouped',
    controlKey: 'leaseExpiryWindow',
    columns: [
      { key: 'monthLabel', label: 'Renewal month' },
      { key: 'leases', label: 'Leases', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      { key: 'inProgress', label: 'Renewal started', align: 'right', type: 'number' },
      { key: 'notStarted', label: 'Not started', align: 'right', type: 'number' },
    ],
    totals: [
      { key: 'expiring', label: 'Upcoming renewals', type: 'number', keep: true },
      { key: 'renewedOrAccepted', label: 'Renewed / Accepted', type: 'number' },
      { key: 'awaitingDecision', label: 'Awaiting Decision', type: 'number' },
      { key: 'rejected', label: 'Rejected', type: 'number' },
      { key: 'contractedRentFils', label: 'Contracted Rent', type: 'aed' },
    ],
    drilldown: {
      childKey: 'items',
      titleKey: 'monthLabel',
      countLabel: 'leases',
      contractIdKey: 'contractId',
      columns: [
        { key: 'contractRef', label: 'Contract' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'buildingName', label: 'Property' },
        { key: 'endDate', label: 'Lease ends', type: 'date' },
        { key: 'daysUntilExpiry', label: 'Days left', align: 'right', type: 'number' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
        { key: 'renewalStatus', label: 'Renewal', type: 'stage' },
      ],
    },
  },
  'leases-by-year': {
    title: 'Leases - Monthly',
    description: 'The year’s leases grouped by the month each one COMMENCED — every lease that started during the selected year (leases carried over from an earlier year are not included). Each row is a month; expand it to see the leases that began that month. All twelve months are listed, so a month with no new leases reads 0. The tiles show how many leases commenced and the annual rent they represent, how many of them have already ended, and how many are still active now. Pick the year above.',
    endpoint: '/api/reports/leases-by-year',
    buildingLeaseFilter: true,
    leaseStatusFilter: true,
    layout: 'grouped',
    controlKey: 'year',
    columns: [
      { key: 'monthLabel', label: 'Commenced' },
      { key: 'leases', label: 'Leases', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      { key: 'ended', label: 'Ended in year', align: 'right', type: 'number' },
      { key: 'active', label: 'Active now', align: 'right', type: 'number' },
    ],
    totals: [
      { key: 'leases', label: 'Leases commenced', type: 'number', keep: true },
      { key: 'annualRentFils', label: 'Annual rent', type: 'aed', keep: true },
      { key: 'endedThisYear', label: 'Ended', type: 'number', keep: true },
      { key: 'active', label: 'Currently active', type: 'number' },
    ],
    drilldown: {
      childKey: 'items',
      titleKey: 'monthLabel',
      countLabel: 'leases',
      contractIdKey: 'contractId',
      columns: [
        { key: 'contractRef', label: 'Contract' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'buildingName', label: 'Property' },
        { key: 'startDate', label: 'Start', type: 'date' },
        { key: 'endDate', label: 'End', type: 'date' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
        { key: 'status', label: 'Status', type: 'stage' },
      ],
    },
  },
  // Both slugs resolve to the same forecast (renewal-forecast is canonical;
  // renewal-pipeline kept so older links/bookmarks still work).
  'renewal-forecast': RENEWAL_FORECAST_DEF,
  'renewal-pipeline': RENEWAL_FORECAST_DEF,
  'security-deposits': {
    title: 'Security Deposits Report',
    description: 'Full deposit register and settlement ledger. A deposit is collected at lease start and refundable at lease end. Status shows where each one stands: Holding (live lease), Pending settlement (lease ended — needs to be refunded or deducted), or settled as Returned, Partial return or Forfeited. Refunded / Kept are the amounts that moved at settlement. The tiles up top answer how much you currently hold, how much is pending settlement, and what has been refunded to tenants vs kept. Pick a year to scope the register to deposits taken that year, or All years for the full register.',
    endpoint: '/api/reports/security-deposits',
    buildingLeaseFilter: true,
    controlKey: 'yearRange',
    columns: [
      { key: 'unitLabel', label: 'Unit No' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'buildingName', label: 'Building' },
      { key: 'depositFils', label: 'Security Deposit', align: 'right', type: 'aed' },
      { key: 'state', label: 'Status', type: 'stage' },
      { key: 'reference', label: 'Payment' },
    ],
    rowLink: { idKey: 'contractId', colKey: 'unitLabel', target: 'contract' },
    totals: [
      { key: 'heldFils', label: 'Held now (with us)', type: 'aed', keep: true },
      { key: 'dueForSettlementFils', label: 'Pending settlement', type: 'aed', keep: true },
      { key: 'refundedFils', label: 'Refunded to tenants', type: 'aed' },
      { key: 'deductedFils', label: 'Kept / forfeited', type: 'aed' },
      { key: 'totalFils', label: 'Total collected', type: 'aed', keep: true },
      { key: 'held', label: 'Held (count)', type: 'number', keep: true },
    ],
  },

  'rent-collection': {
    title: 'Cash Management',
    description: 'The collection matrix — every unit down the side, the twelve months of the year across the top, with each unit\'s annual rent. Each cell is that month\'s rent cheque, coloured by status (collected / pending / bounced), with a row total, and year-to-date expected vs received. Pick the year above.',
    endpoint: '/api/reports/rent-collection',
    buildingLeaseFilter: true,
    dataNote: NEEDS_CHEQUE_DATA,
    layout: 'matrix',
    controlKey: 'year',
    columns: [],
    totals: [
      { key: 'customers', label: 'Units', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
      { key: 'scheduledFils', label: 'Total rent', type: 'aed' },
      { key: 'ytdExpectedFils', label: 'YTD expected', type: 'aed' },
      { key: 'ytdReceivedFils', label: 'YTD received', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', type: 'aed' },
      { key: 'collectionRate', label: 'Collection rate', type: 'rate' },
    ],
  },

  'cheques-management': {
    title: 'Cheques Management',
    description: 'The cheque schedule — one row per current active lease (live today; upcoming and ended leases are excluded), showing the building, unit and lease duration together, then each rent cheque\'s due date (earliest to latest), a column per month counting how many cheques land in it, and the total number of cheques. Rent (rental-roll) cheques only; cancelled cheques are excluded. Leases counts the rows; Units the distinct units behind them. Pick the year above and narrow by property.',
    endpoint: '/api/reports/cheques-management',
    buildingLeaseFilter: true,
    dataNote: NEEDS_CHEQUE_DATA,
    layout: 'chequeMatrix',
    controlKey: 'year',
    columns: [],
    totals: [
      { key: 'leases', label: 'Leases', type: 'number' },
      { key: 'units', label: 'Units', type: 'number' },
      { key: 'totalCheques', label: 'Total cheques', type: 'number' },
    ],
  },

  'manager-performance': {
    title: 'Manager Performance Report',
    tagline: 'Who did what — your team\u2019s work and presence at a glance.',
    description: 'Each row is one of your managers. The numbers count real things they worked on — leads they handled (and converted), leases and renewals they progressed, documents they processed — not clicks. Created / Updated / Deleted shows the type of work; Pages and Reports show how present they were in the system; automatic system entries are excluded. Click any row to see that person\u2019s day-by-day actions. Detailed tracking started 7 July 2026, so older periods show less.',
    endpoint: '/api/reports/manager-performance',
    controlKey: 'dateRange',
    columns: [
      { key: 'name', label: 'Team member' },
      { key: 'role', label: 'Role', type: 'stage' },
      // keep: the scorecard always shows its full shape — a zero column is
      // information here ("no leads attended"), not noise to auto-hide.
      { key: 'leadsWorked', label: 'Leads attended', align: 'right', type: 'number', keep: true },
      { key: 'leadsConverted', label: 'Converted', align: 'right', type: 'number', keep: true },
      { key: 'contractsWorked', label: 'Contracts worked', align: 'right', type: 'number', keep: true },
      { key: 'renewalsWorked', label: 'Renewals', align: 'right', type: 'number', keep: true },
      { key: 'documentsWorked', label: 'Documents', align: 'right', type: 'number', keep: true },
      { key: 'created', label: 'Created', align: 'right', type: 'number', keep: true },
      { key: 'updated', label: 'Updated', align: 'right', type: 'number', keep: true },
      { key: 'deleted', label: 'Deleted', align: 'right', type: 'number', keep: true },
      { key: 'pagesViewed', label: 'Pages viewed', align: 'right', type: 'number', keep: true },
      { key: 'reportsViewed', label: 'Reports viewed', align: 'right', type: 'number', keep: true },
      { key: 'activeDays', label: 'Days active', align: 'right', type: 'number', keep: true },
      { key: 'lastActiveAt', label: 'Last active', type: 'date' },
    ],
    totals: [
      { key: 'teamMembers', label: 'Team members', type: 'number', keep: true },
      { key: 'leadsWorked', label: 'Leads attended', type: 'number', keep: true },
      { key: 'contractsWorked', label: 'Contracts worked', type: 'number', keep: true },
    ],
    // Click a team member → their chronological activity feed (most recent
    // first, capped at 200 in the period). Contract items link to the lease.
    // Row click opens the full-page member profile, which loads its feed from
    // the paginated /manager-activity-feed endpoint (nothing embedded here).
    drilldown: {
      childKey: 'activity',
      titleKey: 'name',
      countLabel: 'recent actions',
      columns: [],
    },
  },

  'lease-activity': {
    title: 'Lease Status Summary',
    tagline: 'Your leasing year, month by month \u2014 renewals due, contracts signed, Contract Registration, move-outs.',
    description: 'For each month of the selected year: how many leases came up for renewal, how many new and renewal contracts started, deposits received, renewal notices sent, tenant and landlord signatures, Contract Registration completed vs still pending, move-outs, and the average days it took tenants to sign. All figures come straight from your contract records \u2014 nothing is compiled by hand \u2014 and past months fill in automatically.',
    endpoint: '/api/reports/lease-activity',
    controlKey: 'year',
    columns: [
      { key: 'label', label: 'Month' },
      { key: 'due', label: 'Due for renewal', align: 'right', type: 'number' },
      { key: 'newLeases', label: 'New contracts', align: 'right', type: 'number' },
      { key: 'deposits', label: 'Deposits', align: 'right', type: 'number' },
      { key: 'renewalNotices', label: 'Renewal notices', align: 'right', type: 'number' },
      { key: 'renewalContracts', label: 'Renewal contracts', align: 'right', type: 'number' },
      { key: 'tenantSigns', label: 'Tenant signs', align: 'right', type: 'number' },
      { key: 'landlordSigns', label: 'Landlord signs', align: 'right', type: 'number' },
      { key: 'ejariRegistered', label: 'Contract Registration completed', align: 'right', type: 'number' },
      { key: 'ejariPending', label: 'Awaiting Contract Registration', align: 'right', type: 'number' },
      { key: 'moveOuts', label: 'Move-outs', align: 'right', type: 'number' },
      { key: 'avgDaysToSign', label: 'Avg days to sign', align: 'right', type: 'number' },
    ],
    totals: [
      { key: 'due', label: 'Due for renewal', type: 'number', keep: true },
      { key: 'renewalContracts', label: 'Renewals signed up', type: 'number', keep: true },
      { key: 'newLeases', label: 'New contracts', type: 'number' },
      { key: 'ejariRegistered', label: 'Contract Registration completed', type: 'number', keep: true },
      { key: 'ejariPending', label: 'Awaiting Contract Registration', type: 'number', keep: true },
      { key: 'moveOuts', label: 'Move-outs', type: 'number' },
      { key: 'avgDaysToSign', label: 'Avg days to sign', type: 'number' },
    ],
    // Click a month to see the leases that commenced it (the "New contracts"
    // figure). The other columns are cross-cut metrics on the same leases.
    drilldown: {
      childKey: 'items',
      titleKey: 'label',
      countLabel: 'new contracts',
      contractIdKey: 'contractId',
      columns: [
        { key: 'contractRef', label: 'Contract' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'buildingName', label: 'Property' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'startDate', label: 'Start', type: 'date' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      ],
    },
  },


  'new-leases-matrix': {
    title: 'Lease Summary - Yearly',
    description: 'A property × month grid of leases that COMMENCED (started) each month of the selected year — the matrix companion to Contract Registration Activity. Each cell counts the new leases that began that month for the property; the trailing columns give the property’s total new leases and the annual rent they represent. Anchored on the lease start date (real leases only — pending drafts excluded). Pick the year above.',
    endpoint: '/api/reports/new-leases-matrix',
    buildingLeaseFilter: true,
    layout: 'countMatrix',
    controlKey: 'year',
    columns: [],
    matrixTrailing: [
      { key: 'newLeases', label: 'New leases', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
    ],
    cellDrill: {
      countLabel: 'new lease',
      contractIdKey: 'contractId',
      columns: [
        { key: 'contractRef', label: 'Contract' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'startDate', label: 'Start', type: 'date' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      ],
    },
    totals: [
      { key: 'newLeases', label: 'New leases', type: 'number', keep: true },
      { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
      { key: 'properties', label: 'Properties', type: 'number' },
    ],
  },
  'renewal-vacancy': {
    title: 'Renewal Plan - Yearly',
    description: 'Renewal calendar per property for the selected year — every property down the side, the twelve months across the top, then Renewals · Total Vacant · Total Units. Each occupied unit is counted once, in the month its lease comes up for renewal (the day after the term ends), so the months add up to Renewals — the units renewing that year, which changes as you switch years. Total Vacant and Total Units are your current inventory (each unit’s live status) and don’t change by year. Click a Vacant count to list those units.',
    endpoint: '/api/reports/renewal-vacancy',
    buildingLeaseFilter: true,
    layout: 'countMatrix',
    controlKey: 'year',
    columns: [],
    cellDrill: {
      countLabel: 'renewal',
      contractIdKey: 'contractId',
      columns: [
        { key: 'contractRef', label: 'Contract' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'endDate', label: 'Lease ends', type: 'date' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      ],
    },
    totals: [
      { key: 'leased', label: 'Renewals', type: 'number', keep: true },
      { key: 'vacant', label: 'Total Vacant', type: 'number', keep: true },
      { key: 'totalUnits', label: 'Total Units', type: 'number', keep: true },
      { key: 'properties', label: 'Properties', type: 'number' },
    ],
  },

  'executive-cashflow': {
    title: 'Executive Cashflow',
    tagline: 'Your rent cashflow, month by month — expected vs received, what’s pending or bounced, and Net Income.',
    description: 'For each month of the selected year: the rent Expected (every cheque due, cancelled ones excluded), how much was Received (cleared), what is still Pending, what Bounced, the Penalty income collected, and Net Income (received rent + penalties). Anchored on the cheque date; the totals up top are the year-to-date figures. Pick the year above.',
    endpoint: '/api/reports/executive-cashflow',
    dataNote: NEEDS_CHEQUE_DATA + ' Penalty income is penalty / late-fee cheques cleared in the month (bounced-cheque, replacement, deferral and the late/early lifecycle penalties) — admin, Contract Registration and commission fees are in the Fee & VAT report. Net Income = received rent + penalties.',
    controlKey: 'year',
    columns: [
      { key: 'label', label: 'Month' },
      { key: 'expectedFils', label: 'Expected', align: 'right', type: 'aed' },
      { key: 'receivedFils', label: 'Received', align: 'right', type: 'aed' },
      { key: 'pendingFils', label: 'Pending', align: 'right', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', align: 'right', type: 'aed' },
      { key: 'penaltyFils', label: 'Penalty', align: 'right', type: 'aed' },
      { key: 'netIncomeFils', label: 'Net Income', align: 'right', type: 'aed' },
      { key: 'collectionRate', label: 'Collection %', align: 'right', type: 'rate' },
      { key: 'clearedCount', label: 'Cleared #', align: 'right', type: 'number' },
      { key: 'pendingCount', label: 'Pending #', align: 'right', type: 'number' },
      { key: 'bouncedCount', label: 'Bounced #', align: 'right', type: 'number' },
    ],
    totals: [
      { key: 'expectedFils', label: 'Expected', type: 'aed', keep: true },
      { key: 'receivedFils', label: 'Received', type: 'aed', keep: true },
      { key: 'pendingFils', label: 'Pending', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', type: 'aed' },
      { key: 'penaltyFils', label: 'Penalty', type: 'aed' },
      { key: 'netIncomeFils', label: 'Net Income', type: 'aed', keep: true },
      { key: 'collectionRate', label: 'Collection rate', type: 'rate' },
    ],
    // Click a month to see the individual rent cheques anchored in it.
    drilldown: {
      childKey: 'items',
      titleKey: 'label',
      countLabel: 'cheques',
      contractIdKey: 'contractId',
      columns: [
        { key: 'contractRef', label: 'Contract' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'chequeNumber', label: 'Cheque #' },
        { key: 'dueDate', label: 'Due', type: 'date' },
        { key: 'amountFils', label: 'Amount', align: 'right', type: 'aed' },
        { key: 'status', label: 'Status', type: 'stage' },
      ],
    },
  },

  'portfolio-overview': {
    title: 'Unit Mix',
    description: 'Your unit mix — one row per property × unit type × bedrooms × layout × size, with the unit count, exactly as the Unit Mix on a property\'s detail page (details only, no amounts). Units of different sizes are listed separately.',
    endpoint: '/api/reports/portfolio-overview',
    buildingLeaseFilter: true,
    unitTypeFilter: true,
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'unitType', label: 'Unit type', type: 'stage' },
      { key: 'bedroomsPlan', label: 'Bedrooms · Plan' },
      { key: 'sizeSqft', label: 'Sqft', align: 'right' },
      { key: 'units', label: 'Units', align: 'right', type: 'number' },
    ],
    totals: [
      { key: 'properties', label: 'Properties', type: 'number' },
      { key: 'units', label: 'Units', type: 'number' },
    ],
    // Click a mix row to list the individual units folded into it.
    drilldown: {
      childKey: 'unitList',
      titleKey: 'buildingName',
      countLabel: 'units',
      columns: [
        { key: 'unitLabel', label: 'Unit' },
        { key: 'unitType', label: 'Type', type: 'stage' },
        { key: 'bedrooms', label: 'Beds', align: 'right', type: 'number' },
        { key: 'sizeSqft', label: 'Sqft', align: 'right' },
      ],
    },
  },

  'vacancy-analysis': {
    title: 'Vacant Units',
    description: 'Vacant units to action — each available unit with its Market Price (units.rental_price, the asking rent · revenue at stake) and the Annual Rent it last let for (latest lease, net of discount), plus listing status and overall portfolio occupancy. A current snapshot; time-on-market is not tracked yet.',
    endpoint: '/api/reports/vacancy-analysis',
    buildingLeaseFilter: true,
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'unitType', label: 'Type', type: 'stage' },
      { key: 'bedrooms', label: 'Beds', align: 'right', type: 'number' },
      { key: 'listingStatus', label: 'Listing', type: 'stage' },
      { key: 'askingRentFils', label: 'Market Price', align: 'right', type: 'aed' },
      { key: 'lastAnnualRentFils', label: 'Annual Rent', align: 'right', type: 'aed' },
    ],
    rowLink: { idKey: 'unitId', colKey: 'unitLabel', target: 'unit' },
    totals: [
      { key: 'vacant', label: 'Vacant units', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', type: 'rate' },
      { key: 'listed', label: 'Listed', type: 'number' },
      { key: 'unlisted', label: 'Unlisted', type: 'number' },
      { key: 'vacantAskingFils', label: 'Market Price', type: 'aed' },
      { key: 'vacantLastRentFils', label: 'Annual Rent', type: 'aed' },
    ],
  },

  'leasing-activity': {
    title: 'Contract Registration Activity',
    description: 'Monthly leasing velocity — new leases commencing each month, the annual rent they represent, and Contract Registration status. Anchored on the lease start date. Note: historical renewals were imported without a renewal link, so they appear here as new leases.',
    endpoint: '/api/reports/leasing-activity',
    buildingLeaseFilter: true,
    controlKey: 'dateRange',
    columns: [
      { key: 'label', label: 'Month' },
      { key: 'newLeases', label: 'Leases', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent signed', align: 'right', type: 'aed' },
      { key: 'ejariRegistered', label: 'Contract Registration completed', align: 'right', type: 'number' },
      { key: 'ejariPending', label: 'Awaiting Contract Registration', align: 'right', type: 'number' },
    ],
    totals: [
      { key: 'newLeases', label: 'Leases', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent signed', type: 'aed' },
      { key: 'ejariRegistered', label: 'Contract Registration completed', type: 'number' },
      { key: 'ejariPending', label: 'Awaiting Contract Registration', type: 'number' },
    ],
    drilldown: {
      childKey: 'items',
      titleKey: 'label',
      countLabel: 'leases',
      contractIdKey: 'contractId',
      columns: [
        { key: 'contractRef', label: 'Contract' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'buildingName', label: 'Property' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'startDate', label: 'Start', type: 'date' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
        { key: 'ejari', label: 'Registration', type: 'stage' },
      ],
    },
  },

  'rent-vs-market': {
    title: 'Rent vs Asking',
    description: 'Each occupied unit\'s current contracted rent against the unit\'s asking price — the gap is the rent you can recover when the lease renews. Sorted by biggest uplift first. "At market" is within ±5% of the asking price.',
    endpoint: '/api/reports/rent-vs-market',
    buildingLeaseFilter: true,
    dataNote: 'The benchmark is each unit\'s asking price (rental_price) as maintained on the Units page — update it there if it looks stale. Units without an asking price are listed but excluded from the uplift total.',
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitType', label: 'Type', type: 'stage' },
      { key: 'currentRentFils', label: 'Annual Rent', align: 'right', type: 'aed' },
      { key: 'marketRentFils', label: 'Market Price', align: 'right', type: 'aed' },
      { key: 'gapFils', label: 'Gap', align: 'right', type: 'delta' },
      { key: 'gapPct', label: 'Gap %', align: 'right', type: 'rate' },
      { key: 'position', label: 'Position', type: 'stage' },
      { key: 'leaseEnd', label: 'Lease ends', type: 'date' },
    ],
    rowLink: { idKey: 'contractId', colKey: 'unitLabel', target: 'contract' },
    totals: [
      { key: 'units', label: 'Occupied units', type: 'number' },
      { key: 'belowMarket', label: 'Below asking', type: 'number' },
      { key: 'aboveMarket', label: 'Above asking', type: 'number' },
      { key: 'currentRentFils', label: 'Current rent (all units)', type: 'aed' },
      { key: 'marketRentFils', label: 'Asking (priced units)', type: 'aed' },
      { key: 'upliftFils', label: 'Uplift at renewal', type: 'aed' },
    ],
  },

  'fee-taxation': {
    title: 'Fee & VAT (Taxation)',
    description: 'One-off fees and rent VAT per year, bucketed by the contract start date — net, VAT and the output VAT to file. Admin & commission are VAT-able (5%); Contract Registration is exempt; rent VAT applies to commercial/industrial leases. Scope the period with the date range, and narrow to specific buildings or a leasing model (direct vs sub-lease).',
    endpoint: '/api/reports/fee-taxation',
    feeTaxationControls: true,
    controlKey: 'dateRange',
    buildingLeaseFilter: true,
    dataNote: 'Admin, Contract Registration and commission are the actual fee payment rows recorded on each contract (net + VAT), summed across all cheque statuses — manual overrides are reflected. Rent VAT = annual rent × the contract\'s stored VAT rate (commercial / industrial only; residential is exempt). Only issued/active/expired/terminated contracts are counted. Leasing model (direct vs sub-lease) is set per building — change it from the Building filter or the property form.',
    columns: [
      { key: 'periodLabel', label: 'Period' },
      { key: 'contracts', label: 'Contracts', align: 'right', type: 'number' },
      { key: 'adminNetFils', label: 'Admin (net)', align: 'right', type: 'aed' },
      { key: 'adminVatFils', label: 'Admin VAT', align: 'right', type: 'aed' },
      { key: 'ejariNetFils', label: 'Contract Registration (net)', align: 'right', type: 'aed' },
      { key: 'ejariVatFils', label: 'Contract Registration VAT', align: 'right', type: 'aed' },
      { key: 'commissionNetFils', label: 'Commission (net)', align: 'right', type: 'aed' },
      { key: 'commissionVatFils', label: 'Commission VAT', align: 'right', type: 'aed' },
      { key: 'rentNetFils', label: 'Rent (net)', align: 'right', type: 'aed' },
      { key: 'rentVatFils', label: 'Rent VAT', align: 'right', type: 'aed' },
      { key: 'totalVatFils', label: 'Total VAT', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'contracts', label: 'Contracts', type: 'number' },
      { key: 'adminNetFils', label: 'Admin (net)', type: 'aed' },
      { key: 'adminVatFils', label: 'Admin VAT', type: 'aed' },
      { key: 'ejariNetFils', label: 'Contract Registration (net)', type: 'aed' },
      { key: 'ejariVatFils', label: 'Contract Registration VAT', type: 'aed' },
      { key: 'commissionNetFils', label: 'Commission (net)', type: 'aed' },
      { key: 'commissionVatFils', label: 'Commission VAT', type: 'aed' },
      { key: 'rentNetFils', label: 'Rent (net)', type: 'aed' },
      { key: 'rentVatFils', label: 'Rent VAT', type: 'aed' },
      { key: 'totalVatFils', label: 'Total VAT', type: 'aed' },
    ],
    // Summary (overall) view: click a period row to see the contracts behind it
    // — the same per-contract lines as the Detailed view, filtered to the period
    // and joined synthetically from data.items (see the row-click handler).
    drilldown: {
      childKey: 'items',
      titleKey: 'periodLabel',
      countLabel: 'contracts',
      contractIdKey: 'contractId',
      columns: [
        { key: 'contractRef', label: 'Contract' },
        { key: 'buildingName', label: 'Property' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
        { key: 'totalVatFils', label: 'Total VAT', align: 'right', type: 'aed' },
      ],
    },
  },
};

// Fee & VAT — the DETAILED (per-contract) view columns. Every line traces a
// figure in the per-period summary back to the contract that produced it, so the
// totals can be audited. Reuses the standard table render (sortable / CSV).
const FEE_DETAIL_COLUMNS: Column[] = [
  { key: 'periodLabel', label: 'Period' },
  { key: 'contractRef', label: 'Contract' },
  { key: 'buildingName', label: 'Property' },
  { key: 'unitLabel', label: 'Unit' },
  { key: 'tenantName', label: 'Customer' },
  { key: 'startDate', label: 'Start', type: 'date' },
  { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
  { key: 'adminNetFils', label: 'Admin (net)', align: 'right', type: 'aed' },
  { key: 'adminVatFils', label: 'Admin VAT', align: 'right', type: 'aed' },
  { key: 'ejariNetFils', label: 'Contract Registration (net)', align: 'right', type: 'aed' },
  { key: 'ejariVatFils', label: 'Contract Registration VAT', align: 'right', type: 'aed' },
  { key: 'commissionNetFils', label: 'Commission (net)', align: 'right', type: 'aed' },
  { key: 'commissionVatFils', label: 'Commission VAT', align: 'right', type: 'aed' },
  { key: 'rentVatFils', label: 'Rent VAT', align: 'right', type: 'aed' },
  { key: 'totalVatFils', label: 'Total VAT', align: 'right', type: 'aed' },
];

// Reports whose rows are tenant/financial and so honour the "active tenants
// only" vs "all" scope toggle (backend ?scope=all includes ended tenants).
// Inventory / occupancy reports aren't listed — they have no ended-tenant noise.
const TENANT_SCOPED = new Set<ReportSlug>([
  'security-deposits', 'executive-cashflow', 'rent-collection',
  'leasing-activity', 'fee-taxation',
]);

// Local-date YYYY-MM-DD (no UTC shift) for the date-range control presets.
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Current calendar year — used by the year dropdown (yearRange reports).
const CURRENT_YEAR = new Date().getFullYear();
// Reports that default to a single day (today) rather than the whole year — a
// daily activity view (e.g. Manager Performance).
const DAILY_DEFAULT_SLUGS = new Set<ReportSlug>(['manager-performance']);
const todayRange = () => { const t = isoLocal(new Date()); return { from: t, to: t }; };

function fmtAed(fils: number | null | undefined): string {
  const n = Number(fils ?? 0);
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n / 100);
}
function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-AE').format(n);
}
// Compact amount for matrix cells — no currency symbol, no decimals.
function fmtAmt(fils: number | null | undefined): string {
  const n = Number(fils ?? 0);
  if (!n) return '·';
  return new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(n / 100);
}
// Rent-roll cell colour by cheque status.
const CELL_STATUS_STYLE: Record<string, string> = {
  cleared:   'text-[#15803d]',          // collected → green
  pending:   'text-[#b45309]',          // outstanding → amber
  bounced:   'text-[#dc2626] font-semibold', // bounced → red
  cancelled: 'text-[#9b9890] line-through',
};
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
}

const BUCKET_STYLE: Record<string, string> = {
  upcoming: 'bg-[#e8f4fd] text-[#1e3a8a]',
  current:  'bg-[#fef3c7] text-[#854d0e]',
  '1-30':   'bg-[#fed7aa] text-[#9a3412]',
  '31-60':  'bg-[#fdba74] text-[#7c2d12]',
  '61-90':  'bg-[#fca5a5] text-[#7f1d1d]',
  '90+':    'bg-[#dc2626] text-white',
  undated:  'bg-[#f4f3ef] text-[#6b6860]',  // pending cheque with no due date — age unknown
};
const STAGE_STYLE: Record<string, string> = {
  not_started: 'bg-[#f4f3ef] text-[#6b6860]',
  proposed:    'bg-[#fef3c7] text-[#854d0e]',
  accepted:    'bg-[#dcfce7] text-[#166534]',
  signed:      'bg-[#dbeafe] text-[#1e40af]',
  active:      'bg-[#d8f2e8] text-[#1a7a5a]',
  available:   'bg-[#dcfce7] text-[#166534]',
  rejected:    'bg-[#fee2e2] text-[#b91c1c]',
  renewed:     'bg-[#dcfce7] text-[#166534]',  // renewal completed — new term already running
  // contract-status lifecycle (leases-by-year register)
  issued:      'bg-[#dbeafe] text-[#1e40af]',  // signed/issued, term not yet started
  terminated:  'bg-[#fee2e2] text-[#b91c1c]',  // ended early
  // security-deposit lifecycle
  holding:            'bg-[#dbeafe] text-[#1e40af]',  // held against a live lease
  pending_settlement: 'bg-[#fef3c7] text-[#854d0e]',  // lease ended → refund/deduct it
  returned:           'bg-[#dcfce7] text-[#166534]',
  partial_return:     'bg-[#e0e7ff] text-[#3730a3]',
  forfeited:          'bg-[#fee2e2] text-[#b91c1c]',
  // listing-status lifecycle (vacancy-analysis)
  draft:     'bg-[#f4f3ef] text-[#6b6860]',  // grey — not yet live
  pending:   'bg-[#fef3c7] text-[#854d0e]',  // amber — awaiting review
  in_review: 'bg-[#fef3c7] text-[#854d0e]',  // amber — under review
  published: 'bg-[#dcfce7] text-[#166534]',  // green — live/listed
  expired:   'bg-[#fee2e2] text-[#b91c1c]',  // red — lapsed (rejected already above)
  // rent-vs-market position (gap to benchmark)
  below_market: 'bg-[#d8f2e8] text-[#1a7a5a]',  // rent under market → recoverable uplift
  at_market:    'bg-[#f4f3ef] text-[#6b6860]',  // within ±5% → neutral
  above_market: 'bg-[#fee2e2] text-[#b91c1c]',  // rent over market → downside on renewal
  no_benchmark: 'bg-[#f4f3ef] text-[#6b6860]',  // no market price set
  // operations-pipeline signature states — on_file deliberately NOT signed
  signed_state: 'bg-[#dbeafe] text-[#1e40af]',
  // manager-operations stage-gap ownership — whose clock the gap runs on
  manager:  'bg-[#e0f2fe] text-[#0369a1]',      // sky — manager work
  customer: 'bg-[#fef3c7] text-[#854d0e]',      // amber — waiting on the customer
  landlord: 'bg-[#d8f2e8] text-[#1a7a5a]',      // green — landlord counter-sign
};

function drillRowClass(item: Record<string, unknown>): string {
  return item.availability === 'available'
    ? 'border-t border-[#bbf7d0] bg-[#f0fdf4] hover:bg-[#dcfce7]'
    : 'border-t border-[#f0ede8] hover:bg-[#fafaf8]';
}

function CellValue({ value, type }: { value: unknown; type?: Column['type'] }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-[#c8c6c0]">—</span>;
  }
  if (type === 'aed') return <span>{fmtAed(Number(value))}</span>;
  if (type === 'number') return <span>{fmtNumber(Number(value))}</span>;
  if (type === 'date') return <span>{fmtDate(String(value))}</span>;
  if (type === 'rate') return <span>{Number(value).toFixed(1)}%</span>;
  if (type === 'delta') {
    const v = Number(value);
    if (v === 0) return <span className="text-[#6b6860] inline-flex items-center gap-1"><Minus size={11} /> {fmtAed(0)}</span>;
    return v > 0
      ? <span className="text-[#1a7a5a] inline-flex items-center gap-1"><TrendingUp size={11} /> {fmtAed(v)}</span>
      : <span className="text-red-600 inline-flex items-center gap-1"><TrendingDown size={11} /> {fmtAed(v)}</span>;
  }
  if (type === 'bucket') {
    const cls = BUCKET_STYLE[String(value)] ?? 'bg-[#f4f3ef] text-[#6b6860]';
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${cls}`}>{String(value)}</span>;
  }
  if (type === 'stage') {
    const cls = STAGE_STYLE[String(value)] ?? 'bg-[#f4f3ef] text-[#6b6860]';
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${cls}`}>{String(value).replace(/_/g, ' ')}</span>;
  }
  return <span>{String(value)}</span>;
}

function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers.map(toCsvCell).join(','), ...rows.map(r => r.map(toCsvCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ReportDetailViewProps {
  slug: string;
  /** '/api/reports' (RP) or '/api/manager/reports' (manager). */
  endpointBase?: string;
  /** Extra query glued to every fetch, e.g. 'rp=4' for managers. */
  extraQuery?: string;
  /** Back target: href (RP routes) or onBack callback (manager inline). */
  backHref?: string;
  onBack?: () => void;
  /** Base for 'Open contract' links in drill-downs. */
  contractsBase?: string;
  /** Base for 'Open unit' links (e.g. vacant-unit rows). Omit in portals with
   *  no unit detail route (manager) — unit links are then not rendered. */
  unitsBase?: string;
  /** When set, control changes sync to the URL (RP slug routes only). */
  urlBase?: string;
}

export function ReportDetailView({
  slug: slugProp,
  endpointBase = '/api/reports',
  extraQuery = '',
  backHref = '/rental-provider/dashboard/reports',
  onBack,
  contractsBase = '/rental-provider/dashboard/contracts',
  unitsBase,
  urlBase,
}: ReportDetailViewProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const slug = slugProp as ReportSlug;
  const def = REPORTS[slug];

  const [data, setData] = useState<{ generatedAt: string; totals: Record<string, number>; rows: Record<string, unknown>[]; windowDays?: number; months?: string[]; columnTotals?: number[]; maxCheques?: number; year?: number; buildings?: BuildingOption[]; unitTypes?: string[]; items?: Record<string, unknown>[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [leaseWindow, setLeaseWindow] = useState<number>(() => Number(sp?.get('window') ?? 90));
  const [forecastMonths, setForecastMonths] = useState<number>(() => Number(sp?.get('months') ?? 12));
  // Default every date-range report to the hub-wide year chosen on the Reports
  // landing page (persisted in localStorage); an explicit URL param still wins.
  // "All years" → an empty range (no from/to), i.e. all-time.
  const [from, setFrom] = useState<string>(() => sp?.get('from') ?? (DAILY_DEFAULT_SLUGS.has(slug) ? todayRange().from : yearToRange(getReportsYear()).from));
  const [to, setTo]     = useState<string>(() => sp?.get('to') ?? (DAILY_DEFAULT_SLUGS.has(slug) ? todayRange().to : yearToRange(getReportsYear()).to));
  // Matrix (rent-roll) year selector — defaults to the hub year (current if "All").
  const [year, setYear] = useState<number>(() => Number(sp?.get('year')) || yearForMatrix(getReportsYear()));
  // Tenant scope — show active customers only (default) or include ended tenants.
  const [scope, setScope] = useState<'active' | 'all'>(() => (sp?.get('scope') === 'all' ? 'all' : 'active'));
  // Cash Management: client-side property filter ('' = all properties).
  const [propertyFilter, setPropertyFilter] = useState('');
  // Unit Mix: server-side Unit type filter ('' = all types).
  const [unitTypeSel, setUnitTypeSel] = useState<string>(() => sp?.get('unitType') ?? '');
  // Lease-status segment (leases-by-year): Active · Expired · All. Backend
  // default is 'all', so only an explicit active/expired needs sending.
  const [leaseStatus, setLeaseStatus] = useState<'active' | 'expired' | 'all'>(
    () => (sp?.get('status') === 'active' ? 'active' : sp?.get('status') === 'expired' ? 'expired' : 'all'),
  );
  // Occupancy segment (portfolio): All · Occupied · Vacant. Backend default is
  // 'all', so only an explicit occupied/vacant needs sending. Occupied gives the
  // passing/in-place rent; Vacant gives the hold-over value on empty units.
  const [occupancy, setOccupancy] = useState<'all' | 'occupied' | 'vacant'>(
    () => (sp?.get('occupancy') === 'occupied' ? 'occupied' : sp?.get('occupancy') === 'vacant' ? 'vacant' : 'all'),
  );
  const [drill, setDrill] = useState<Record<string, unknown> | null>(null);
  const [drillFilter, setDrillFilter] = useState<string | null>(null);
  const [vacantList, setVacantList] = useState<{ title: string; units: VacantUnit[] } | null>(null);
  // Generic matrix cell → records popup (property×month counts, per-cheque cells).
  const [cellModal, setCellModal] = useState<{ title: string; countLabel: string; columns: Column[]; contractIdKey?: string; items: Record<string, unknown>[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Fee-taxation building + leasing-model filters. [] buildings = all; lease
  // types default to both selected (= all). Inline reclassify bumps refreshTick
  // to refetch so the rows reflect the building's new leasing model.
  const [selectedBuildings, setSelectedBuildings] = useState<number[]>([]);
  const [selectedLeaseTypes, setSelectedLeaseTypes] = useState<LeaseType[]>([...ALL_LEASE_TYPES]);
  const [buildingMenuOpen, setBuildingMenuOpen] = useState(false);
  const [classifyingId, setClassifyingId] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const buildingMenuRef = useRef<HTMLDivElement>(null);
  // Fee-taxation: view (per-period summary vs per-contract detail) + bucketing
  // granularity (year vs quarter). View is client-only — one fetch returns both
  // rows + items; granularity re-buckets server-side so it refetches.
  const [feeView, setFeeView] = useState<'overall' | 'detailed'>('overall');
  const [granularity, setGranularity] = useState<'year' | 'quarter'>(() => (sp?.get('groupBy') === 'quarter' ? 'quarter' : 'year'));
  // RP portal can reclassify a building's leasing model inline; managers can't.
  const canClassify = endpointBase === '/api/reports';

  // Hub-wide year (Reports landing page). The useState defaults above seed from
  // it on mount; this keeps a report in sync when the year is changed on the hub
  // and the user returns to (or re-opens) the report — Next's router cache can
  // re-serve the segment without remounting. An explicit URL param at mount pins
  // the period and opts out. Reports without a year/date control simply ignore it.
  const hubYear = useReportsYear();
  const periodPinnedRef = useRef(!!(sp?.get('from') || sp?.get('to') || sp?.get('year')));
  useEffect(() => {
    if (periodPinnedRef.current || !def) return;
    if (def.controlKey === 'dateRange' || def.controlKey === 'yearRange') {
      // Daily-default reports stay on today regardless of the hub year.
      const r = DAILY_DEFAULT_SLUGS.has(slug) ? todayRange() : yearToRange(hubYear);
      setFrom(r.from); setTo(r.to);
    } else if (def.controlKey === 'year') {
      setYear(yearForMatrix(hubYear));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubYear, def]);

  useEffect(() => {
    if (!def) return;
    setLoading(true); setError(null);
    const endpoint = endpointBase + def.endpoint.slice('/api/reports'.length);
    let url = endpoint;
    if (def.controlKey === 'leaseExpiryWindow') {
      url = `${endpoint}?window=${leaseWindow}`;
    } else if (def.controlKey === 'forecastMonths') {
      url = `${endpoint}?months=${forecastMonths}`;
    } else if (def.controlKey === 'dateRange' || def.controlKey === 'yearRange') {
      // yearRange is a year dropdown that maps the picked year to from/to bounds
      // (empty = All years), so it reuses the same from/to query the backend
      // already honours — no separate ?year= param needed here.
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if ([...qs.keys()].length) url = `${endpoint}?${qs.toString()}`;
    } else if (def.controlKey === 'year') {
      url = `${endpoint}?year=${year}`;
    }
    // Building + leasing-model filters (fee-taxation). Buildings: omit when none
    // selected (= all). Lease types: send only when a strict subset is selected;
    // all or none → no param (= all), so a contract is never hidden by an empty
    // selection.
    if (def.buildingLeaseFilter) {
      const extra = new URLSearchParams();
      if (selectedBuildings.length) extra.set('buildings', selectedBuildings.join(','));
      if (selectedLeaseTypes.length > 0 && selectedLeaseTypes.length < ALL_LEASE_TYPES.length)
        extra.set('leaseTypes', selectedLeaseTypes.join(','));
      // Year/Quarter grouping is a Fee & VAT control only.
      if (def.feeTaxationControls && granularity === 'quarter') extra.set('groupBy', 'quarter');
      const s = extra.toString();
      if (s) url += (url.includes('?') ? '&' : '?') + s;
    }
    // Tenant scope — only the tenant/financial reports honour it; default is
    // active-only on the backend, so only the explicit "all" needs sending.
    if (TENANT_SCOPED.has(slug) && scope === 'all') url += (url.includes('?') ? '&' : '?') + 'scope=all';
    // Unit type filter (Unit Mix).
    if (def.unitTypeFilter && unitTypeSel) url += (url.includes('?') ? '&' : '?') + 'unitType=' + encodeURIComponent(unitTypeSel);
    if (def.leaseStatusFilter && leaseStatus !== 'all') url += (url.includes('?') ? '&' : '?') + 'status=' + leaseStatus;
    if (def.occupancyFilter && occupancy !== 'all') url += (url.includes('?') ? '&' : '?') + 'occupancy=' + occupancy;
    if (extraQuery) url += (url.includes('?') ? '&' : '?') + extraQuery;
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [def, slug, leaseWindow, forecastMonths, from, to, year, scope, unitTypeSel, leaseStatus, occupancy, endpointBase, extraQuery, selectedBuildings, selectedLeaseTypes, granularity, refreshTick]);

  // Close the building filter menu on an outside click.
  useEffect(() => {
    if (!buildingMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (buildingMenuRef.current && !buildingMenuRef.current.contains(e.target as Node)) setBuildingMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [buildingMenuOpen]);

  const buildingOptions = data?.buildings ?? [];
  // Simple-bar cascade: when exactly one lease type is chosen, the Property
  // dropdown lists only buildings of that leasing model.
  const leaseFilteredBuildingOptions = selectedLeaseTypes.length === 1
    ? buildingOptions.filter(b => b.leasingType === selectedLeaseTypes[0])
    : buildingOptions;
  // Empty selection = ALL buildings. Boxes render checked in that state; the
  // first toggle expands to an explicit set, and re-selecting everything
  // collapses back to "all" (empty) so the report stays unfiltered.
  const allBuildingIds = buildingOptions.map(b => b.id);
  const isAllBuildings = selectedBuildings.length === 0;
  const buildingChecked = (id: number) => isAllBuildings || selectedBuildings.includes(id);
  const toggleBuilding = (id: number) =>
    setSelectedBuildings(prev => {
      const base = prev.length === 0 ? allBuildingIds : prev;
      const next = base.includes(id) ? base.filter(b => b !== id) : [...base, id];
      return next.length === allBuildingIds.length ? [] : next; // all selected → "all"
    });
  // Toggle a leasing model; never allow an empty selection (resets to all).
  const toggleLeaseType = (t: LeaseType) =>
    setSelectedLeaseTypes(prev => {
      const next = prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t];
      return next.length ? next : [...ALL_LEASE_TYPES];
    });
  // Reclassify a building's leasing model inline (RP only). Optimistic on the
  // badge, then refetch so the rows/totals follow the new model.
  async function classifyBuilding(id: number, leasingType: LeaseType) {
    if (!canClassify) return;
    setClassifyingId(id);
    setData(prev => prev ? { ...prev, buildings: prev.buildings?.map(b => b.id === id ? { ...b, leasingType } : b) } : prev);
    try {
      await apiPatch(`/properties/${id}`, { leasingType });
    } catch {
      /* fall through — the refetch re-syncs the badge from the server */
    } finally {
      setRefreshTick(t => t + 1);
      setClassifyingId(null);
    }
  }

  // Fee-taxation Detailed view swaps the per-period summary for per-contract
  // line items, reusing the whole table pipeline (sort / search / CSV / render).
  // For every other report these collapse to def.columns / data.rows unchanged.
  const feeDetailed = !!def?.feeTaxationControls && feeView === 'detailed';
  const activeColumns = useMemo(() => {
    const base = feeDetailed ? FEE_DETAIL_COLUMNS : def.columns;
    if (!def?.feeTaxationControls) return base;
    // Period column header follows the chosen granularity.
    const periodLabel = granularity === 'quarter' ? 'Quarter' : 'Year';
    return base.map(c => (c.key === 'periodLabel' ? { ...c, label: periodLabel } : c));
  }, [def, feeDetailed, granularity]);
  const activeRows: Record<string, unknown>[] = feeDetailed ? (data?.items ?? []) : (data?.rows ?? []);
  // The drill-down chevron column shows only where rows are actually drillable.
  // Fee & VAT drills from its SUMMARY rows (into data.items); its Detailed rows
  // link the contract directly, so no chevron column there.
  const showDrillCol = !!def?.drilldown && !(slug === 'fee-taxation' && feeDetailed);

  // Distinct property names for the Cash Management / Cheques Management dropdown.
  const propertyOptions = useMemo(() => {
    if (def.layout !== 'matrix' && def.layout !== 'chequeMatrix') return [];
    return [...new Set(activeRows.map(r => String(r.buildingName ?? '')).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b));
  }, [def.layout, activeRows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (def.layout === 'matrix' || def.layout === 'chequeMatrix') {
      let rows = activeRows;
      if (propertyFilter) rows = rows.filter(row => String(row.buildingName ?? '') === propertyFilter);
      if (needle) rows = rows.filter(row =>
        ['customer', 'unitLabel', 'buildingName', 'contractRef'].some(
          k => String(row[k] ?? '').toLowerCase().includes(needle)));
      return rows;
    }
    if (!needle) return activeRows;
    if (def.layout === 'countMatrix') {
      return activeRows.filter(row => String(row.label ?? '').toLowerCase().includes(needle));
    }
    return activeRows.filter(row =>
      activeColumns.some(c => String(row[c.key] ?? '').toLowerCase().includes(needle)),
    );
  }, [activeRows, activeColumns, search, def, propertyFilter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    // Numeric columns compare as numbers even when the backend sent the value as
    // a string (otherwise "1000" sorts before "900"). Text columns use a
    // numeric-aware, case-insensitive collation so "Villa 10" follows "Villa 2"
    // and capitalisation doesn't split the alphabetical order. Blanks last.
    const col = activeColumns.find(c => c.key === sortKey);
    const numericCol = ['aed', 'number', 'rate', 'delta'].includes(col?.type ?? '');
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aEmpty = av === null || av === undefined || av === '';
      const bEmpty = bv === null || bv === undefined || bv === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (numericCol || (typeof av === 'number' && typeof bv === 'number')) {
        const d = Number(av) - Number(bv);
        return sortDir === 'asc' ? d : -d;
      }
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir, activeColumns]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function toggleGroup(key: string) {
    setCollapsed(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  // Grouped layout: each row is a month bucket; filter its child leases by the
  // search needle and drop buckets with no matching leases.
  const groups = useMemo(() => {
    const dd = def?.drilldown;
    if (def?.layout !== 'grouped' || !dd || !data?.rows) return [];
    const needle = search.trim().toLowerCase();
    return data.rows
      .map(row => {
        const items = (row[dd.childKey] as Record<string, unknown>[] | undefined) ?? [];
        const matched = !needle ? items : items.filter(it =>
          dd.columns.some(c => String(it[c.key] ?? '').toLowerCase().includes(needle)));
        // When a search is active, recompute the header summary columns from the
        // visible (matched) items so the month chips equal the rows shown beneath:
        // a count column → number of matched rows; a money column → their sum.
        let summary = row;
        if (needle) {
          summary = { ...row };
          for (const c of def.columns) {
            if (c.key === dd.titleKey) continue;
            if (c.type === 'number') summary[c.key] = matched.length;
            else if (c.type === 'aed' || c.type === 'delta')
              summary[c.key] = matched.reduce((s, it) => s + Number(it[c.key] ?? 0), 0);
          }
        }
        return { row: summary, items: matched };
      })
      .filter(g => g.items.length > 0);
  }, [def, data, search]);

  // Rent-roll matrix: when a search needle narrows the visible customers, the
  // footer (per-month + grand total), the KPI chips and the CSV "Total" row must
  // reflect the rows shown. Per-row totalFils/collectedFils/outstandingFils are
  // exact; bounced is summed from the bounced-ranked cells (best available).
  const matrixView = useMemo(() => {
    if (def.layout !== 'matrix' || !data) return null;
    const monthCount = (data.months ?? []).length;
    if (!search.trim() && !propertyFilter) return { columnTotals: data.columnTotals ?? [], totals: data.totals };
    const colTotals = new Array(monthCount).fill(0);
    let scheduled = 0, collected = 0, outstanding = 0, bounced = 0, annualRent = 0, ytdExpected = 0, ytdReceived = 0;
    sorted.forEach(row => {
      scheduled += Number(row.totalFils ?? 0);
      collected += Number(row.collectedFils ?? 0);
      outstanding += Number(row.outstandingFils ?? 0);
      annualRent += Number(row.annualRentFils ?? 0);
      ytdExpected += Number(row.ytdExpectedFils ?? 0);
      ytdReceived += Number(row.ytdReceivedFils ?? 0);
      const cells = (row.cells as { amountFils: number; status: string | null }[] | undefined) ?? [];
      cells.forEach((c, ci) => {
        if (ci < monthCount) colTotals[ci] += Number(c.amountFils) || 0;
        if (c.status === 'bounced') bounced += Number(c.amountFils) || 0;
      });
    });
    return {
      columnTotals: colTotals,
      totals: {
        customers: sorted.length,
        annualRentFils: annualRent,
        scheduledFils: scheduled,
        ytdExpectedFils: ytdExpected,
        ytdReceivedFils: ytdReceived,
        collectedFils: collected,
        outstandingFils: outstanding,
        bouncedFils: bounced,
        collectionRate: scheduled > 0 ? Math.round((collected / scheduled) * 1000) / 10 : 0,
      } as Record<string, number>,
    };
  }, [def.layout, data, search, sorted, propertyFilter]);

  // Cheque-schedule matrix: per-month cheque counts and total are always
  // recomputed from the visible rows, so the footer + tiles follow the property
  // filter and search without a refetch.
  const chequeView = useMemo(() => {
    if (def.layout !== 'chequeMatrix' || !data) return null;
    const colTotals = new Array(12).fill(0);
    let totalCheques = 0;
    const unitIds = new Set<number>();
    sorted.forEach(row => {
      const mc = (row.monthCounts as number[] | undefined) ?? [];
      mc.forEach((n, i) => { if (i < 12) colTotals[i] += Number(n) || 0; });
      totalCheques += Number(row.totalCheques ?? 0);
      if (row.unitId != null) unitIds.add(Number(row.unitId));
    });
    return { columnTotals: colTotals, totals: { leases: sorted.length, units: unitIds.size, totalCheques } as Record<string, number> };
  }, [def.layout, data, sorted]);

  // Count-matrix (renewal-vacancy): when a search narrows the visible
  // properties, recompute the per-month footer, grand total and KPI tiles from
  // the rows shown. No search → trust the server's full totals.
  const countMatrixView = useMemo(() => {
    if (def.layout !== 'countMatrix' || !data) return null;
    const monthCount = (data.months ?? []).length;
    if (!search.trim()) return { columnTotals: data.columnTotals ?? [], totals: data.totals };
    const colTotals = new Array(monthCount).fill(0);
    sorted.forEach(row => {
      const cells = (row.cells as number[] | undefined) ?? [];
      cells.forEach((n, ci) => { if (ci < monthCount) colTotals[ci] += Number(n) || 0; });
    });
    // Generic trailing columns (e.g. new-leases matrix): sum each trailing key
    // across the visible rows; keep a live property count where the report has one.
    if (def.matrixTrailing) {
      const totals: Record<string, number> = {};
      for (const c of def.matrixTrailing) totals[c.key] = sorted.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      if (data.totals && 'properties' in data.totals) totals.properties = sorted.length;
      return { columnTotals: colTotals, totals };
    }
    let leased = 0, vacant = 0, totalUnits = 0;
    sorted.forEach(row => {
      leased += Number(row.total ?? 0);
      vacant += Number(row.vacant ?? 0);
      totalUnits += Number(row.totalUnits ?? 0);
    });
    return {
      columnTotals: colTotals,
      totals: {
        leased,
        vacant,
        totalUnits,
        properties: sorted.length,
      } as Record<string, number>,
    };
  }, [def.layout, data, search, sorted]);

  // Auto-hide all-zero numeric tiles/columns so reports don't surface dead
  // columns (VAT, admin/ejari fees, bounced, ejari-registered …) full of zeros
  // in datasets that don't capture that data yet. Text/identity columns always
  // stay; rate tiles always stay (a real 0% is meaningful). CSV keeps everything.
  const deadTotalKeys = useMemo(() => {
    const dead = new Set<string>();
    if (!data) return dead;
    for (const t of def.totals) {
      if (!t.keep && (t.type === 'aed' || t.type === 'number')) {
        const v = data.totals?.[t.key];
        if (v == null || Number(v) === 0) dead.add(t.key);
      }
    }
    return dead;
  }, [data, def]);

  const deadColKeys = useMemo(() => {
    const dead = new Set<string>();
    if (!activeRows.length || def.layout) return dead; // plain table only
    for (const c of activeColumns) {
      if (!c.keep && (c.type === 'aed' || c.type === 'number')) {
        const allZero = activeRows.every(r => { const v = r[c.key]; return v == null || Number(v) === 0; });
        if (allZero) dead.add(c.key);
      }
    }
    return dead;
  }, [activeRows, activeColumns, def]);

  const visibleColumns = useMemo(() => activeColumns.filter(c => !deadColKeys.has(c.key)), [activeColumns, deadColKeys]);
  const visibleTotals = useMemo(() => def.totals.filter(t => !deadTotalKeys.has(t.key)), [def, deadTotalKeys]);

  // Filter-bar styling. Three modes:
  //  • simpleFilterBar — every report with the Property + Lease-type dropdowns
  //    except Fee & VAT: ALL controls (period/year/window + the two dropdowns)
  //    flow inline in ONE wrapping row inside a single bordered card.
  //  • fee-taxation — its many controls stack as aligned rows (divide-y card).
  //  • no filter — the wrapper collapses (display:contents) and each control
  //    keeps its own bare row.
  const simpleFilterBar = !!def?.buildingLeaseFilter && !def?.feeTaxationControls;
  const filtersPanel = !!def?.buildingLeaseFilter && !!def?.feeTaxationControls;
  const ctrlRowCls = simpleFilterBar
    ? 'flex items-center gap-2 flex-wrap print:hidden'
    : filtersPanel
      ? 'flex items-center gap-2 flex-wrap px-4 py-3 print:hidden'
      : 'flex items-center gap-2 mb-4 flex-wrap print:hidden';
  const ctrlLabelCls = filtersPanel
    ? 'text-xs text-[#6b6860] font-semibold min-w-[104px]'
    : 'text-xs text-[#6b6860] font-medium';
  // Simple-filter-bar group: a small label stacked directly above its field, so
  // every filter (Year · Property · Lease type · Customers) lines up as one row
  // of matching label-over-dropdown columns.
  const fGroup = 'flex flex-col gap-1';
  const fLabel = 'text-[10px] uppercase tracking-wide font-semibold text-[#9b9890] px-0.5';
  const fSelect = 'text-xs font-semibold text-[#1a1916] bg-white border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#2e9f82] cursor-pointer disabled:opacity-50';

  function handleCsv() {
    if (!data) return;
    const datestamp = new Date(data.generatedAt).toISOString().slice(0, 10);
    const fmtCell = (raw: unknown, type?: Column['type']) => {
      if (type === 'aed' || type === 'delta') return raw == null ? '' : (Number(raw) / 100).toFixed(2);
      if (type === 'date') return raw ? new Date(String(raw)).toISOString().slice(0, 10) : '';
      return raw ?? '';
    };

    // Matrix layout: unit + property + annual rent, a column per month, then
    // total and the year-to-date expected / received columns.
    if (def.layout === 'matrix') {
      const months = data.months ?? [];
      const headers = ['Unit', 'Property', 'Start', 'End', 'Annual rent', ...months, 'Total', 'YTD Expected', 'YTD Received'];
      const rows = sorted.map(row => {
        const cells = (row.cells as { amountFils: number }[]) ?? [];
        return [
          String(row.unitLabel ?? ''),
          String(row.buildingName ?? ''),
          row.contractStartDate ? String(row.contractStartDate) : '',
          row.contractEndDate ? String(row.contractEndDate) : '',
          (Number(row.annualRentFils) / 100).toFixed(2),
          ...cells.map(c => (Number(c.amountFils) / 100).toFixed(2)),
          (Number(row.totalFils) / 100).toFixed(2),
          (Number(row.ytdExpectedFils) / 100).toFixed(2),
          (Number(row.ytdReceivedFils) / 100).toFixed(2),
        ];
      });
      rows.push([
        'Total', '', '', '',
        (Number(matrixView?.totals?.annualRentFils ?? data.totals?.annualRentFils ?? 0) / 100).toFixed(2),
        ...(matrixView?.columnTotals ?? data.columnTotals ?? []).map(t => (Number(t) / 100).toFixed(2)),
        (Number(matrixView?.totals?.scheduledFils ?? data.totals?.scheduledFils ?? 0) / 100).toFixed(2),
        (Number(matrixView?.totals?.ytdExpectedFils ?? data.totals?.ytdExpectedFils ?? 0) / 100).toFixed(2),
        (Number(matrixView?.totals?.ytdReceivedFils ?? data.totals?.ytdReceivedFils ?? 0) / 100).toFixed(2),
      ]);
      // Cumulative — running total of the monthly column totals.
      let csvRun = 0;
      const csvCum = (matrixView?.columnTotals ?? data.columnTotals ?? []).map(t => (csvRun += Number(t) || 0));
      rows.push([
        'Cumulative', '', '', '', '',
        ...csvCum.map(t => (t / 100).toFixed(2)),
        (csvRun / 100).toFixed(2), '', '',
      ]);
      downloadCsv(`${slug}-${data.year ?? datestamp}.csv`, headers, rows);
      return;
    }

    // Cheque-schedule matrix: building + unit + customer, one column per cheque
    // date (up to the widest lease), a column per month (cheque count), then the
    // total cheque count.
    if (def.layout === 'chequeMatrix') {
      const months = data.months ?? [];
      const maxCheques = data.maxCheques ?? 0;
      const chequeCols = Array.from({ length: maxCheques }, (_, i) => `Cheque ${i + 1}`);
      const headers = ['Building', 'Unit', 'Start', 'End', 'Customer', ...chequeCols, ...months, 'Total cheques'];
      const rows = sorted.map(row => {
        const dates = (row.chequeDates as string[]) ?? [];
        const counts = (row.monthCounts as number[]) ?? [];
        return [
          String(row.buildingName ?? ''),
          String(row.unitLabel ?? ''),
          row.contractStartDate ? String(row.contractStartDate) : '',
          row.contractEndDate ? String(row.contractEndDate) : '',
          String(row.customer ?? ''),
          ...Array.from({ length: maxCheques }, (_, i) => dates[i] ?? ''),
          ...counts.map(n => String(Number(n) || 0)),
          String(Number(row.totalCheques) || 0),
        ];
      });
      rows.push([
        'Total', '', '', '', '',
        ...Array.from({ length: maxCheques }, () => ''),
        ...(chequeView?.columnTotals ?? data.columnTotals ?? []).map(t => String(Number(t) || 0)),
        String(Number(chequeView?.totals?.totalCheques ?? data.totals?.totalCheques) || 0),
      ]);
      downloadCsv(`${slug}-${data.year ?? datestamp}.csv`, headers, rows);
      return;
    }

    // Count-matrix layout: property, a column per month, then the trailing
    // summary columns (Renewals · Vacant · Total units by default, or the
    // report's own `matrixTrailing` set, e.g. New leases · Annual rent).
    if (def.layout === 'countMatrix') {
      const months = data.months ?? [];
      const trailing = def.matrixTrailing;
      const csvNum = (c: { type?: string }, v: number) => c.type === 'aed' ? (v / 100).toFixed(2) : String(v || 0);
      const headers = trailing
        ? ['Property', ...months, ...trailing.map(c => c.label)]
        : ['Property', ...months, 'Renewals', 'Vacant', 'Total units'];
      const rows = sorted.map(row => {
        const cells = (row.cells as number[]) ?? [];
        const base = [String(row.label ?? ''), ...cells.map(n => String(Number(n) || 0))];
        return trailing
          ? [...base, ...trailing.map(c => csvNum(c, Number(row[c.key]) || 0))]
          : [...base, String(Number(row.total) || 0), String(Number(row.vacant) || 0), String(Number(row.totalUnits) || 0)];
      });
      const cmt = countMatrixView?.totals ?? data.totals;
      const totalRow = ['Total', ...(countMatrixView?.columnTotals ?? data.columnTotals ?? []).map(t => String(Number(t) || 0))];
      rows.push(trailing
        ? [...totalRow, ...trailing.map(c => csvNum(c, Number(cmt?.[c.key]) || 0))]
        : [...totalRow, String(Number(cmt?.leased ?? 0)), String(Number(cmt?.vacant ?? 0)), String(Number(cmt?.totalUnits ?? 0))]);
      downloadCsv(`${slug}-${data.year ?? datestamp}.csv`, headers, rows);
      return;
    }

    // Grouped layout: export one row per child lease, prefixed with its group.
    if (def.layout === 'grouped' && def.drilldown) {
      const dd = def.drilldown;
      const headers = [dd.titleLabel ?? 'Month', ...dd.columns.map(c => c.label)];
      const rows = groups.flatMap(g =>
        g.items.map(it => [String(g.row[dd.titleKey] ?? ''), ...dd.columns.map(c => fmtCell(it[c.key], c.type))]),
      );
      downloadCsv(`${slug}-${datestamp}.csv`, headers, rows);
      return;
    }

    const headers = activeColumns.map(c => c.label);
    const rows = sorted.map(row => activeColumns.map(c => fmtCell(row[c.key], c.type)));
    const suffix = feeDetailed ? '-detailed' : '';
    downloadCsv(`${slug}${suffix}-${datestamp}.csv`, headers, rows);
  }

  if (!def) {
    return (
      <div className="p-6">
        {onBack ? (
          <button type="button" onClick={onBack} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-sm">
            <ArrowLeft size={14} /> Back to Reports
          </button>
        ) : (
          <Link href={backHref} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-sm">
            <ArrowLeft size={14} /> Back to Reports
          </Link>
        )}
        <div className="mt-8 text-center text-[#6b6860]">Unknown report: {slug}</div>
      </div>
    );
  }

  // Manager Performance: a row opens a FULL-PAGE member profile, not a modal.
  if (slug === 'manager-performance' && drill && data) {
    return (
      <div className="p-6 print:p-0">
        <MemberActivityView
          member={drill as unknown as MemberRow}
          daily={((data as Record<string, unknown>).daily ?? []) as Array<Record<string, string | number>>}
          dailyPages={((data as Record<string, unknown>).dailyPages ?? []) as Array<Record<string, string | number>>}
          contractsBase={contractsBase}
          feedEndpoint={`${endpointBase}/manager-activity-feed`}
          from={from || null}
          to={to || null}
          onBack={() => setDrill(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-6 print:p-0">
      {/* Sticky header — hidden on print */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4 print:hidden">
        <div>
          {onBack ? (
            <button type="button" onClick={onBack} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2">
              <ArrowLeft size={12} /> All Reports
            </button>
          ) : (
            <Link href={backHref} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2">
              <ArrowLeft size={12} /> All Reports
            </Link>
          )}
          <h1 className="text-xl font-bold text-[#1a1916] flex items-center gap-2">
            {def.title}
            <InfoTip text={def.description} />
          </h1>
          {def.tagline && <p className="text-sm text-[#6b6860] mt-0.5 max-w-2xl">{def.tagline}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCsv}
            disabled={!data || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] disabled:opacity-50 transition-colors bg-white">
            <FileSpreadsheet size={14} /> CSV
          </button>
          <button
            onClick={() => window.print()}
            disabled={!data || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{ background: '#2e9f82' }}>
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block mb-6">
        <h1 className="text-xl font-bold">{def.title}</h1>
        <p className="text-sm text-gray-600">{def.description}</p>
        {data && <p className="text-xs text-gray-500 mt-1">Generated {new Date(data.generatedAt).toLocaleString('en-AE')}</p>}
      </div>

      {/* Data-quality caution banner */}
      {def.dataNote && (
        <div className="flex items-start gap-2 mb-4 px-3.5 py-2.5 rounded-xl bg-[#fef3c7] border border-[#fcd34d] text-[#854d0e] text-xs print:bg-white">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{def.dataNote}</span>
        </div>
      )}

      {/* Filters — grouped into one aligned card for fee-taxation; a transparent
          (display:contents) wrapper everywhere else so single-bar reports are unchanged. */}
      <div className={
        simpleFilterBar
          ? 'rounded-2xl border border-[#e8e6e0] bg-white flex flex-wrap items-end gap-x-4 gap-y-3 px-4 py-3 mb-6 print:hidden'
          : filtersPanel
            ? 'rounded-2xl border border-[#e8e6e0] bg-white divide-y divide-[#f0ede8] mb-6 print:hidden'
            : 'contents'
      }>

      {/* Consolidated filter bar — the time control + Property + Lease type +
          Customer scope, each a label-over-dropdown column, all on one row.
          Replaces the individual control blocks below (which are gated off when
          simpleFilterBar is on). */}
      {simpleFilterBar && (
        <>
          {def.controlKey === 'year' && (
            <div className={fGroup}>
              <span className={fLabel}>Year</span>
              <select className={fSelect} value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Year">
                {Array.from({ length: CURRENT_YEAR - 2022 }, (_, i) => CURRENT_YEAR - i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
          {def.controlKey === 'yearRange' && (
            <div className={fGroup}>
              <span className={fLabel}>Year</span>
              <select className={fSelect}
                value={/^\d{4}-01-01$/.test(from) && to === `${from.slice(0, 4)}-12-31` ? from.slice(0, 4) : 'all'}
                onChange={e => { const v = e.target.value; if (v === 'all') { setFrom(''); setTo(''); } else { setFrom(`${v}-01-01`); setTo(`${v}-12-31`); } }}
                aria-label="Year">
                <option value="all">All years</option>
                {Array.from({ length: CURRENT_YEAR - 2022 }, (_, i) => CURRENT_YEAR - i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
          {def.controlKey === 'leaseExpiryWindow' && (
            <div className={fGroup}>
              <span className={fLabel}>Window</span>
              <select className={fSelect} value={leaseWindow}
                onChange={e => { const w = Number(e.target.value); setLeaseWindow(w); if (urlBase) router.replace(`${urlBase}/lease-expiry?window=${w}`); }}
                aria-label="Window">
                {[30, 60, 90, 180, 365].map(w => <option key={w} value={w}>{w} days</option>)}
              </select>
            </div>
          )}
          {def.controlKey === 'forecastMonths' && (
            <div className={fGroup}>
              <span className={fLabel}>Horizon</span>
              <select className={fSelect} value={forecastMonths}
                onChange={e => { const m = Number(e.target.value); setForecastMonths(m); if (urlBase) router.replace(`${urlBase}/${slug}?months=${m}`); }}
                aria-label="Horizon">
                {[3, 6, 12, 24].map(m => <option key={m} value={m}>{m} months</option>)}
              </select>
            </div>
          )}
          {def.controlKey === 'dateRange' && (
            <div className={fGroup}>
              <span className={fLabel}>Period</span>
              <DateRangePicker from={from} to={to} placeholder="All time" onChange={(f, t) => { setFrom(f); setTo(t); }} />
            </div>
          )}
          {/* Lease type FIRST — picking one narrows the Property list below to
              matching buildings (and resets the property choice so it can't point
              at a now-hidden building). */}
          <div className={fGroup}>
            <span className={fLabel}>Lease type</span>
            <select className={fSelect} aria-label="Lease type"
              value={selectedLeaseTypes.length === 1 ? selectedLeaseTypes[0] : 'all'}
              onChange={e => { setSelectedLeaseTypes(e.target.value === 'all' ? [...ALL_LEASE_TYPES] : [e.target.value as LeaseType]); setSelectedBuildings([]); }}>
              <option value="all">All lease types</option>
              <option value="direct">Lease</option>
              <option value="sub">Sub-lease</option>
              <option value="management">Management</option>
            </select>
          </div>
          <div className={fGroup}>
            <span className={fLabel}>Property</span>
            <select className={fSelect} aria-label="Property"
              value={selectedBuildings.length === 1 ? String(selectedBuildings[0]) : 'all'}
              onChange={e => setSelectedBuildings(e.target.value === 'all' ? [] : [Number(e.target.value)])}
              disabled={leaseFilteredBuildingOptions.length === 0}>
              <option value="all">All properties</option>
              {leaseFilteredBuildingOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {def.unitTypeFilter && (
            <div className={fGroup}>
              <span className={fLabel}>Unit type</span>
              <select className={fSelect} aria-label="Unit type"
                value={unitTypeSel}
                onChange={e => setUnitTypeSel(e.target.value)}
                disabled={(data?.unitTypes ?? []).length === 0}>
                <option value="">All unit types</option>
                {(data?.unitTypes ?? []).map(t => <option key={t} value={t}>{prettyUnitType(t)}</option>)}
              </select>
            </div>
          )}
          {TENANT_SCOPED.has(slug) && (
            <div className={fGroup}>
              <span className={fLabel}>Customers</span>
              <select className={fSelect} aria-label="Customers" value={scope} onChange={e => setScope(e.target.value as 'active' | 'all')}>
                <option value="active">Active only</option>
                <option value="all">Incl. ended</option>
              </select>
            </div>
          )}
          {def.leaseStatusFilter && (
            <div className={fGroup}>
              <span className={fLabel}>Leases</span>
              <select className={fSelect} aria-label="Lease status" value={leaseStatus} onChange={e => setLeaseStatus(e.target.value as 'active' | 'expired' | 'all')}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          )}
          {def.occupancyFilter && (
            <div className={fGroup}>
              <span className={fLabel}>Occupancy</span>
              <select className={fSelect} aria-label="Occupancy" value={occupancy} onChange={e => setOccupancy(e.target.value as 'all' | 'occupied' | 'vacant')}>
                <option value="all">All</option>
                <option value="occupied">Occupied</option>
                <option value="vacant">Vacant</option>
              </select>
            </div>
          )}
        </>
      )}

      {/* Lease-expiry window control (non-simple reports only — the simple bar
          above renders this as a dropdown). */}
      {!simpleFilterBar && def.controlKey === 'leaseExpiryWindow' && (
        <div className={ctrlRowCls}>
          <span className={ctrlLabelCls}>Window:</span>
          {[30, 60, 90, 180, 365].map(w => (
            <button
              key={w}
              onClick={() => { setLeaseWindow(w); if (urlBase) router.replace(`${urlBase}/lease-expiry?window=${w}`); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${leaseWindow === w ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
              {w} days
            </button>
          ))}
        </div>
      )}

      {/* Renewal-forecast horizon control (non-simple reports only). */}
      {!simpleFilterBar && def.controlKey === 'forecastMonths' && (
        <div className={ctrlRowCls}>
          <span className={ctrlLabelCls}>Horizon:</span>
          {[3, 6, 12, 24].map(m => (
            <button
              key={m}
              onClick={() => { setForecastMonths(m); if (urlBase) router.replace(`${urlBase}/${slug}?months=${m}`); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${forecastMonths === m ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
              {m} months
            </button>
          ))}
        </div>
      )}

      {/* Date-range control — single picker with preset shortcuts + two-month
          calendar (shared across every date-range report). Non-simple only. */}
      {!simpleFilterBar && def.controlKey === 'dateRange' && (
        <div className={ctrlRowCls}>
          <span className={ctrlLabelCls}>Period:</span>
          <DateRangePicker from={from} to={to}
            placeholder="All time"
            onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </div>
      )}

      {/* View (overall summary vs per-contract detail) + bucketing granularity. */}
      {def.feeTaxationControls && (
        <div className={ctrlRowCls}>
          <span className={ctrlLabelCls}>View:</span>
          {([
            { id: 'overall',  label: 'Overall' },
            { id: 'detailed', label: 'Detailed' },
          ] as const).map(v => (
            <button key={v.id} onClick={() => setFeeView(v.id)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${feeView === v.id ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
              {v.label}
            </button>
          ))}
          <span className="text-xs text-[#6b6860] font-medium ml-2">Group by:</span>
          {([
            { id: 'year',    label: 'Year' },
            { id: 'quarter', label: 'Quarter' },
          ] as const).map(g => (
            <button key={g.id} onClick={() => { setGranularity(g.id); if (urlBase) router.replace(`${urlBase}/${slug}?groupBy=${g.id}`); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${granularity === g.id ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
              {g.label}
            </button>
          ))}
          <span className="text-[11px] text-[#9b9890] ml-1">
            {feeView === 'detailed' ? 'Every contract — verify the totals add up' : 'Totals per ' + (granularity === 'quarter' ? 'quarter' : 'year')}
          </span>
        </div>
      )}

      {/* Building + leasing-model (direct/sub/management) filters — fee-taxation only. */}
      {def.feeTaxationControls && (
        <div className={ctrlRowCls}>
          {/* Leasing model — true multi-select; all on = all. */}
          <span className={ctrlLabelCls}>Leasing model:</span>
          {([
            { id: 'direct',     label: 'Direct lease' },
            { id: 'sub',        label: 'Sub-lease' },
            { id: 'management', label: 'Management' },
          ] as const).map(t => {
            const on = selectedLeaseTypes.includes(t.id);
            return (
              <button key={t.id} onClick={() => toggleLeaseType(t.id)}
                className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${on ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
                {on && <Check size={12} />} {t.label}
              </button>
            );
          })}

          {/* Building multi-select (with inline reclassify for RPs). */}
          <span className="text-xs text-[#6b6860] font-medium ml-2">Buildings:</span>
          <div className="relative" ref={buildingMenuRef}>
            <button
              type="button"
              disabled={buildingOptions.length === 0}
              onClick={() => setBuildingMenuOpen(o => !o)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              <Building2 size={13} />
              {selectedBuildings.length === 0
                ? (buildingOptions.length ? 'All buildings' : 'No buildings')
                : `${selectedBuildings.length} of ${buildingOptions.length}`}
              <ChevronDown size={13} className={buildingMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
            {buildingMenuOpen && buildingOptions.length > 0 && (
              <div className="absolute z-40 mt-1 left-0 w-80 bg-white border border-[#e8e6e0] rounded-xl shadow-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#f0eeea] bg-[#faf9f6]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9890]">{isAllBuildings ? 'All buildings' : `${selectedBuildings.length} of ${allBuildingIds.length} selected`}</span>
                  {!isAllBuildings && (
                    <button type="button" onClick={() => setSelectedBuildings([])}
                      className="text-[11px] font-semibold text-[#2e9f82] hover:underline">Reset to all</button>
                  )}
                </div>
                <ul className="max-h-72 overflow-y-auto py-1">
                  {buildingOptions.map(b => {
                    const checked = buildingChecked(b.id);
                    return (
                      <li key={b.id} className="flex items-center gap-2 px-3 py-2 hover:bg-[#f9f8f5]">
                        <button type="button" onClick={() => toggleBuilding(b.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                          <span className={`w-4 h-4 rounded border grid place-items-center shrink-0 ${checked ? 'bg-[#2e9f82] border-[#2e9f82]' : 'border-[#c5c2bc] bg-white'}`}>
                            {checked && <Check size={11} className="text-white" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm text-[#1a1916] truncate">{b.name}</span>
                            <span className="block text-[10px] text-[#9b9890]">{b.contracts} contract{b.contracts === 1 ? '' : 's'}{checked ? '' : ' · excluded'}</span>
                          </span>
                        </button>
                        {/* Leasing model — inline toggle for RP, read-only badge for managers. */}
                        {canClassify ? (
                          <span className="inline-flex shrink-0 rounded-md border border-[#e8e6e0] overflow-hidden text-[10px] font-semibold">
                            {ALL_LEASE_TYPES.map(t => (
                              <button key={t} type="button" disabled={classifyingId === b.id}
                                onClick={() => b.leasingType !== t && classifyBuilding(b.id, t)}
                                className={`px-2 py-1 transition-colors disabled:opacity-50 ${b.leasingType === t ? 'bg-[#2e9f82] text-white' : 'bg-white text-[#6b6860] hover:bg-[#f0fdf8]'}`}>
                                {LEASE_TYPE_LABELS[t]}
                              </button>
                            ))}
                          </span>
                        ) : (
                          <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${b.leasingType === 'sub' ? 'bg-[#ede9fe] text-[#5b21b6]' : b.leasingType === 'management' ? 'bg-[#fef0e0] text-[#b45309]' : 'bg-[#d8f2e8] text-[#1a7a5a]'}`}>
                            {b.leasingType === 'sub' ? 'Sub-lease' : b.leasingType === 'management' ? 'Management' : 'Direct'}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Year dropdown (deposit register — "yearly document"): maps the picked
          year to a Jan 1 – Dec 31 from/to range, or clears it for All years.
          Non-simple only. */}
      {!simpleFilterBar && def.controlKey === 'yearRange' && (
        <div className={ctrlRowCls}>
          <span className={ctrlLabelCls}>Year:</span>
          <select
            value={/^\d{4}-01-01$/.test(from) && to === `${from.slice(0, 4)}-12-31` ? from.slice(0, 4) : 'all'}
            onChange={e => {
              const v = e.target.value;
              if (v === 'all') { setFrom(''); setTo(''); }
              else { setFrom(`${v}-01-01`); setTo(`${v}-12-31`); }
            }}
            className="text-xs font-semibold border border-[#e8e6e0] rounded-lg px-3 py-1.5 bg-white text-[#1a1916] focus:outline-none focus:border-[#2e9f82] cursor-pointer">
            <option value="all">All years</option>
            {Array.from({ length: CURRENT_YEAR - 2022 }, (_, i) => CURRENT_YEAR - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      )}

      {/* Property filter (Cash / Cheques Management matrix) — client-side, narrows to one
          building. Superseded by the server-side Property + Lease-type filter when
          buildingLeaseFilter is on, so it's only shown when that isn't. */}
      {!def.buildingLeaseFilter && (def.layout === 'matrix' || def.layout === 'chequeMatrix') && propertyOptions.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap print:hidden">
          <span className="text-xs text-[#6b6860] font-medium">Property:</span>
          <select
            value={propertyFilter}
            onChange={e => setPropertyFilter(e.target.value)}
            className="text-xs font-semibold border border-[#e8e6e0] rounded-lg px-3 py-1.5 bg-white text-[#1a1916] focus:outline-none focus:border-[#2e9f82] cursor-pointer max-w-[280px]">
            <option value="">All properties</option>
            {propertyOptions.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {propertyFilter && (
            <button onClick={() => setPropertyFilter('')}
              className="text-[11px] text-[#9b9890] hover:text-[#6b6860] underline">Clear</button>
          )}
        </div>
      )}

      {/* Year selector (rent-roll matrix) — non-simple only. */}
      {!simpleFilterBar && def.controlKey === 'year' && (
        <div className={ctrlRowCls}>
          <span className={ctrlLabelCls}>Year:</span>
          {Array.from({ length: CURRENT_YEAR - 2021 }, (_, i) => 2023 + i).map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${year === y ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
              {y}
            </button>
          ))}
        </div>
      )}

      {/* Tenant scope — active customers only (default) vs include ended tenants.
          Non-simple only (the simple bar renders this as a dropdown). */}
      {!simpleFilterBar && TENANT_SCOPED.has(slug) && (
        <div className={ctrlRowCls}>
          <span className={ctrlLabelCls}>Customers:</span>
          {([['active', 'Active only'], ['all', 'Incl. ended']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setScope(v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${scope === v ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
              {label}
            </button>
          ))}
          <span className="text-[11px] text-[#9b9890] ml-1">
            {scope === 'active' ? 'Showing current tenants — ended tenancies are hidden.' : 'Showing all tenants, including ended tenancies.'}
          </span>
        </div>
      )}

      </div>{/* /filters */}

      {/* Totals */}
      {data && visibleTotals.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
          {visibleTotals.map(t => {
            const raw = (def.layout === 'matrix' && matrixView ? matrixView.totals
              : def.layout === 'chequeMatrix' && chequeView ? chequeView.totals
              : def.layout === 'countMatrix' && countMatrixView ? countMatrixView.totals
              : data.totals)[t.key];
            return (
              <div key={t.key} className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{t.label}</p>
                <p className="text-sm font-bold text-[#1a1916] mt-0.5">
                  {t.type === 'aed' ? fmtAed(raw) : t.type === 'rate' ? `${Number(raw).toFixed(1)}%` : fmtNumber(raw)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Charts — analytics-style visuals for the reports that carry them */}
      {!loading && !error && data && slug === 'manager-performance' && (
        <ManagerPerformanceCharts
          rows={(data.rows ?? []) as never}
          daily={((data as Record<string, unknown>).daily ?? []) as never}
          dailyPages={((data as Record<string, unknown>).dailyPages ?? []) as never}
          granularity={(data as Record<string, unknown>).granularity as 'hour' | 'day' | undefined}
        />
      )}
      {!loading && !error && data && slug === 'lease-activity' && (
        <LeaseActivityCharts rows={(data.rows ?? []) as never} />
      )}
      {!loading && !error && data && slug === 'executive-cashflow' && (
        <ExecutiveCashflowCharts rows={(data.rows ?? []) as never} />
      )}

      {/* Search */}
      <div className="relative max-w-sm mb-4 print:hidden">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search rows…"
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm focus:outline-none focus:border-[#2e9f82]"
        />
      </div>

      {/* Table */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-[#2e9f82]" />
        </div>
      ) : (def.layout === 'grouped' ? groups.length === 0 : sorted.length === 0) ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
          <BarChart2 size={32} className="mx-auto text-[#c8c6c0] mb-3" />
          <p className="text-sm font-semibold text-[#1a1916]">No data</p>
          <p className="text-xs text-[#9b9890] mt-1">{search ? 'Nothing matches your search.' : 'No matching records found.'}</p>
        </div>
      ) : def.layout === 'grouped' && def.drilldown ? (
        <div className="space-y-3">
          {groups.map((g, gi) => {
            const dd = def.drilldown!;
            const key = String(g.row[dd.titleKey] ?? gi);
            const isCollapsed = collapsed.has(key);
            const isOverdue = g.row['month'] === 'overdue';
            return (
              <div key={key} className={`bg-white rounded-2xl border overflow-hidden ${isOverdue ? 'border-[#fca5a5]' : 'border-[#e8e6e0]'} print:break-inside-avoid`}>
                {/* Month header */}
                <button
                  onClick={() => toggleGroup(key)}
                  className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-[#fafaf8] print:hover:bg-transparent">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ChevronRight size={16} className={`text-[#9b9890] transition-transform print:hidden ${isCollapsed ? '' : 'rotate-90'}`} />
                    <span className={`text-sm font-bold ${isOverdue ? 'text-[#b91c1c]' : 'text-[#1a1916]'}`}>{String(g.row[dd.titleKey] ?? '')}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    {def.columns.filter(c => c.key !== dd.titleKey).map(c => (
                      <span key={c.key} className="text-xs whitespace-nowrap hidden sm:inline">
                        <span className="text-[#9b9890]">{c.label}: </span>
                        <span className="font-semibold text-[#1a1916]"><CellValue value={g.row[c.key]} type={c.type} /></span>
                      </span>
                    ))}
                  </div>
                </button>
                {/* Leases in this month */}
                {!isCollapsed && (
                  <div className="overflow-x-auto border-t border-[#f0ede8]">
                    <table className="w-full text-xs">
                      <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                        <tr>
                          {dd.columns.map(c => (
                            <th key={c.key} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                          ))}
                          {dd.contractIdKey && <th className="px-3 py-2.5 print:hidden" aria-hidden />}
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((it, idx) => (
                          <tr key={idx} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                            {dd.columns.map(c => (
                              <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>
                                <CellValue value={it[c.key]} type={c.type} />
                              </td>
                            ))}
                            {dd.contractIdKey && (
                              <td className="px-3 py-2.5 text-right print:hidden">
                                {it[dd.contractIdKey] != null && (
                                  <Link
                                    href={`${contractsBase}/${it[dd.contractIdKey]}/v2`}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline"
                                    title="Open contract">
                                    Open <ExternalLink size={12} />
                                  </Link>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : def.layout === 'matrix' ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:border-none print:rounded-none">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-full">
              <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                <tr>
                  <th className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-3 text-left font-semibold min-w-[190px]">By Unit</th>
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">Annual rent</th>
                  {(data?.months ?? []).map(m => (
                    <th key={m} className="px-3 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">{m}</th>
                  ))}
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">Total</th>
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">YTD Expected</th>
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">YTD Received</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const cells = (row.cells as { amountFils: number; status: string | null; chequeNumber?: string | null; dueDate?: string | null; chequeCount?: number }[]) ?? [];
                  return (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8] print:break-inside-avoid">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-left">
                        {row.contractId != null ? (
                          <Link href={`${contractsBase}/${row.contractId}/v2`} className="font-medium text-[#2e9f82] leading-tight inline-flex items-center gap-1 hover:underline print:text-[#1a1916] print:no-underline" title="Open contract">
                            {String(row.unitLabel ?? '—')}<ExternalLink size={11} className="print:hidden" />
                          </Link>
                        ) : (
                          <div className="font-medium text-[#1a1916] leading-tight">{String(row.unitLabel ?? '—')}</div>
                        )}
                        <div className="text-[11px] text-[#9b9890] leading-tight">{String(row.buildingName ?? '')}</div>
                        {Boolean(row.contractStartDate || row.contractEndDate) && (
                          <div className="text-[11px] text-[#9b9890] leading-tight">
                            {fmtDate(row.contractStartDate as string)} – {fmtDate(row.contractEndDate as string)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#1a1916] whitespace-nowrap border-l border-[#f0ede8]">{fmtAmt(Number(row.annualRentFils))}</td>
                      {cells.map((c, ci) => (
                        <td key={ci} className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-[#f0ede8] ${c.amountFils ? (CELL_STATUS_STYLE[c.status ?? ''] ?? 'text-[#1a1916]') : 'text-[#d4d2cc]'}`}>
                          {c.amountFils ? (
                            <button
                              type="button"
                              onClick={() => setCellModal({
                                title: `${String(row.unitLabel ?? '')} · ${(data?.months ?? [])[ci] ?? ''}`,
                                countLabel: 'cheque',
                                columns: [
                                  { key: 'chequeNumber', label: 'Cheque #' },
                                  { key: 'dueDate', label: 'Due', type: 'date' },
                                  { key: 'amountFils', label: 'Amount', align: 'right', type: 'aed' },
                                  { key: 'status', label: 'Status', type: 'stage' },
                                ],
                                items: [{ chequeNumber: c.chequeNumber ?? null, dueDate: c.dueDate ?? null, amountFils: c.amountFils, status: c.status }],
                              })}
                              className="hover:underline cursor-pointer print:no-underline"
                              title="See the cheque behind this amount">
                              {fmtAmt(c.amountFils)}{c.chequeCount && c.chequeCount > 1 ? ` (${c.chequeCount})` : ''}
                            </button>
                          ) : fmtAmt(c.amountFils)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-[#1a1916] whitespace-nowrap border-l border-[#f0ede8]">{fmtAmt(Number(row.totalFils))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#1a1916] whitespace-nowrap border-l border-[#f0ede8]">{fmtAmt(Number(row.ytdExpectedFils))}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-[#15803d] whitespace-nowrap">{fmtAmt(Number(row.ytdReceivedFils))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#fafaf8] border-t-2 border-[#e8e6e0] font-bold text-[#1a1916]">
                <tr>
                  <td className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-3 text-left">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap border-l border-[#e8e6e0]">{fmtAmt(matrixView?.totals?.annualRentFils ?? data?.totals?.annualRentFils)}</td>
                  {(matrixView?.columnTotals ?? data?.columnTotals ?? []).map((t, ti) => (
                    <td key={ti} className="px-3 py-3 text-right tabular-nums whitespace-nowrap border-l border-[#e8e6e0]">{fmtAmt(t)}</td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums border-l border-[#e8e6e0]">{fmtAmt(matrixView?.totals?.scheduledFils ?? data?.totals?.scheduledFils)}</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap border-l border-[#e8e6e0]">{fmtAmt(matrixView?.totals?.ytdExpectedFils ?? data?.totals?.ytdExpectedFils)}</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-[#15803d]">{fmtAmt(matrixView?.totals?.ytdReceivedFils ?? data?.totals?.ytdReceivedFils)}</td>
                </tr>
                {/* Cumulative — each month is the running total of every prior month */}
                {(() => {
                  const colTot = matrixView?.columnTotals ?? data?.columnTotals ?? [];
                  let run = 0;
                  const cum = colTot.map(t => (run += Number(t) || 0));
                  return (
                    <tr className="border-t border-[#e8e6e0] font-medium text-[#6b6860]">
                      <td className="sticky left-0 z-10 bg-[#fafaf8] px-3 py-2 text-left font-semibold">Cumulative</td>
                      <td className="px-3 py-2 border-l border-[#e8e6e0]" />
                      {cum.map((t, ti) => (
                        <td key={ti} className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-[#e8e6e0]">{fmtAmt(t)}</td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums border-l border-[#e8e6e0] font-semibold text-[#1a1916]">{fmtAmt(run)}</td>
                      <td className="px-3 py-2 border-l border-[#e8e6e0]" />
                      <td className="px-3 py-2" />
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
          <div className="flex items-center gap-4 px-3 py-2 border-t border-[#f0ede8] text-[11px] text-[#6b6860]">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#15803d]" /> Collected</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#b45309]" /> Pending</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#dc2626]" /> Bounced</span>
            <span className="flex items-center gap-1.5"><span className="text-[#d4d2cc]">·</span> No cheque due</span>
          </div>
        </div>
      ) : def.layout === 'chequeMatrix' ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:border-none print:rounded-none">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-full">
              <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                <tr>
                  <th className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-3 text-left font-semibold min-w-[200px]">Unit / Building / Duration</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Customer</th>
                  {Array.from({ length: data?.maxCheques ?? 0 }, (_, i) => (
                    <th key={i} className={`px-3 py-3 text-right font-semibold whitespace-nowrap ${i === 0 ? 'border-l border-[#e8e6e0]' : ''}`}>Cheque {i + 1}</th>
                  ))}
                  {(data?.months ?? []).map((m, mi) => (
                    <th key={m} className="px-3 py-3 text-center font-semibold whitespace-nowrap border-l border-[#f0ede8]">
                      <div>{m}</div>
                      <div className="text-[9px] font-normal text-[#c8c6c0] normal-case">Month {mi + 1}</div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">Total cheques</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const dates = (row.chequeDates as string[]) ?? [];
                  const counts = (row.monthCounts as number[]) ?? [];
                  const cheques = (row.cheques as { chequeNumber: string | null; dueDate: string | null; amountFils: number; status: string | null; monthIndex: number }[] | undefined) ?? [];
                  return (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8] print:break-inside-avoid">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-left whitespace-nowrap">
                        {row.contractId != null ? (
                          <Link href={`${contractsBase}/${row.contractId}/v2`} className="text-[13px] font-semibold text-[#2e9f82] leading-tight inline-flex items-center gap-1 hover:underline print:text-[#1a1916] print:no-underline" title="Open contract">
                            {String(row.unitLabel ?? '—')}<ExternalLink size={11} className="print:hidden" />
                          </Link>
                        ) : (
                          <div className="text-[13px] font-semibold text-[#1a1916] leading-tight">{String(row.unitLabel ?? '—')}</div>
                        )}
                        <div className="text-[11px] text-[#9b9890] leading-tight">{String(row.buildingName ?? '—')}</div>
                        {Boolean(row.contractStartDate || row.contractEndDate) && (
                          <div className="text-[11px] text-[#9b9890] leading-tight">
                            {fmtDate(row.contractStartDate as string)} – {fmtDate(row.contractEndDate as string)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-left text-[#6b6860] whitespace-nowrap">{String(row.customer ?? '—')}</td>
                      {Array.from({ length: data?.maxCheques ?? 0 }, (_, ci) => (
                        <td key={ci} className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${ci === 0 ? 'border-l border-[#f0ede8]' : ''} ${dates[ci] ? 'text-[#1a1916]' : 'text-[#d4d2cc]'}`}>
                          {dates[ci] ?? '·'}
                        </td>
                      ))}
                      {counts.map((n, ci) => {
                        const monthCheques = cheques.filter(c => c.monthIndex === ci);
                        return (
                        <td key={ci} className={`px-3 py-2.5 text-center tabular-nums whitespace-nowrap border-l border-[#f0ede8] ${n ? 'text-[#1a1916] font-medium' : 'text-[#d4d2cc]'}`}>
                          {n && monthCheques.length ? (
                            <button
                              type="button"
                              onClick={() => setCellModal({
                                title: `${String(row.unitLabel ?? '')} · ${(data?.months ?? [])[ci] ?? ''}`,
                                countLabel: 'cheque',
                                columns: [
                                  { key: 'chequeNumber', label: 'Cheque #' },
                                  { key: 'dueDate', label: 'Due', type: 'date' },
                                  { key: 'amountFils', label: 'Amount', align: 'right', type: 'aed' },
                                  { key: 'status', label: 'Status', type: 'stage' },
                                ],
                                items: monthCheques,
                              })}
                              className="hover:underline cursor-pointer print:no-underline"
                              title="See the cheques landing this month">
                              {fmtNumber(n)}
                            </button>
                          ) : n ? fmtNumber(n) : '·'}
                        </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-[#1a1916] whitespace-nowrap border-l border-[#f0ede8]">{fmtNumber(Number(row.totalCheques))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#fafaf8] border-t-2 border-[#e8e6e0] font-bold text-[#1a1916]">
                <tr>
                  <td className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-3 text-left" colSpan={2 + (data?.maxCheques ?? 0)}>Total</td>
                  {(chequeView?.columnTotals ?? data?.columnTotals ?? []).map((t, ti) => (
                    <td key={ti} className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-l border-[#f0ede8]">{Number(t) ? fmtNumber(Number(t)) : '·'}</td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums border-l border-[#e8e6e0]">{fmtNumber(chequeView?.totals?.totalCheques ?? data?.totals?.totalCheques)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : def.layout === 'countMatrix' ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:border-none print:rounded-none">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-full">
              <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                <tr>
                  <th className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-3 text-left font-semibold min-w-[190px]">Property</th>
                  {(data?.months ?? []).map(m => (
                    <th key={m} className="px-3 py-3 text-right font-semibold whitespace-nowrap">{m}</th>
                  ))}
                  {def.matrixTrailing ? def.matrixTrailing.map((c, ci) => (
                    <th key={c.key} className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${ci === 0 ? 'border-l border-[#e8e6e0]' : ''}`}>{c.label}</th>
                  )) : (<>
                    <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">Renewals</th>
                    <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Vacant</th>
                    <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Total units</th>
                  </>)}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const cells = (row.cells as number[]) ?? [];
                  const cellItems = def.cellDrill
                    ? (row[def.cellDrill.itemsKey ?? 'cellItems'] as Record<string, unknown>[][] | undefined)
                    : undefined;
                  return (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8] print:break-inside-avoid">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-[#1a1916] whitespace-nowrap">{String(row.label ?? '—')}</td>
                      {cells.map((n, ci) => {
                        const num = Number(n);
                        const its = cellItems?.[ci];
                        const drillable = def.cellDrill && num > 0 && Array.isArray(its) && its.length > 0;
                        return (
                        <td key={ci} className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${num ? 'text-[#1a1916]' : 'text-[#d4d2cc]'}`}>
                          {drillable ? (
                            <button
                              type="button"
                              onClick={() => setCellModal({ title: `${String(row.label ?? '')} · ${(data?.months ?? [])[ci] ?? ''}`, countLabel: def.cellDrill!.countLabel, columns: def.cellDrill!.columns, contractIdKey: def.cellDrill!.contractIdKey, items: its! })}
                              className="font-medium text-[#2e9f82] hover:underline cursor-pointer print:no-underline print:text-[#1a1916]"
                              title={`See the ${def.cellDrill!.countLabel} behind this number`}>
                              {fmtNumber(num)}
                            </button>
                          ) : num ? fmtNumber(num) : '·'}
                        </td>
                        );
                      })}
                      {def.matrixTrailing ? def.matrixTrailing.map((c, ci) => (
                        <td key={c.key} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${ci === 0 ? 'font-bold text-[#1a1916] border-l border-[#f0ede8]' : 'text-[#6b6860]'}`}>
                          {c.type === 'aed' ? fmtAed(Number(row[c.key] ?? 0)) : fmtNumber(Number(row[c.key] ?? 0))}
                        </td>
                      )) : (<>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-[#1a1916] whitespace-nowrap border-l border-[#f0ede8]">{fmtNumber(Number(row.total))}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {Number(row.vacant) ? (
                            <button
                              type="button"
                              onClick={() => setVacantList({ title: String(row.label ?? ''), units: (row.vacantUnits as VacantUnit[]) ?? [] })}
                              className="font-medium text-[#b45309] hover:underline cursor-pointer print:no-underline print:text-[#b45309]"
                              title="View vacant units">
                              {fmtNumber(Number(row.vacant))}
                            </button>
                          ) : <span className="text-[#d4d2cc]">·</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#6b6860] whitespace-nowrap">{fmtNumber(Number(row.totalUnits))}</td>
                      </>)}
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={(data?.months?.length ?? 12) + 1 + (def.matrixTrailing?.length ?? 3)} className="px-4 py-8 text-center text-[#9b9890]">No leases in this year.</td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-[#fafaf8] border-t-2 border-[#e8e6e0] font-bold text-[#1a1916]">
                <tr>
                  <td className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-3 text-left">Total</td>
                  {(countMatrixView?.columnTotals ?? data?.columnTotals ?? []).map((t, ti) => (
                    <td key={ti} className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{Number(t) ? fmtNumber(Number(t)) : '·'}</td>
                  ))}
                  {def.matrixTrailing ? def.matrixTrailing.map((c, ci) => {
                    const v = Number((countMatrixView?.totals ?? data?.totals ?? {})[c.key] ?? 0);
                    return (
                      <td key={c.key} className={`px-4 py-3 text-right tabular-nums ${ci === 0 ? 'border-l border-[#e8e6e0]' : ''}`}>
                        {c.type === 'aed' ? fmtAed(v) : fmtNumber(v)}
                      </td>
                    );
                  }) : (<>
                    <td className="px-4 py-3 text-right tabular-nums border-l border-[#e8e6e0]">{fmtNumber(Number(countMatrixView?.totals?.leased ?? data?.totals?.leased ?? 0))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {(() => {
                        const all = sorted.flatMap(r => (r.vacantUnits as VacantUnit[]) ?? []);
                        return all.length ? (
                          <button type="button" onClick={() => setVacantList({ title: 'All properties', units: all })}
                            className="font-bold text-[#b45309] hover:underline cursor-pointer" title="View all vacant units">
                            {fmtNumber(all.length)}
                          </button>
                        ) : fmtNumber(0);
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtNumber(Number(countMatrixView?.totals?.totalUnits ?? data?.totals?.totalUnits ?? 0))}</td>
                  </>)}
                </tr>
              </tfoot>
            </table>
          </div>
          {!def.matrixTrailing && (
            <div className="px-3 py-2 border-t border-[#f0ede8] text-[11px] text-[#6b6860]">
              Months add up to Renewals — the units coming up for renewal in the selected year (each counted once, in its renewal month). Vacant and Total units are current inventory (each unit&rsquo;s live status), independent of the year. Click a Vacant count to list those units.
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:border-none print:rounded-none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                <tr>
                  {visibleColumns.map(c => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className={`px-4 py-3 font-semibold cursor-pointer hover:text-[#1a1916] transition-colors select-none ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`}>
                      {c.label}
                      {sortKey === c.key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                  {showDrillCol && <th className="px-3 py-3 print:hidden" aria-hidden />}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  // Fee & VAT summary rows carry no nested items — synthesise the
                  // drill from data.items filtered to this period, so clicking a
                  // period opens the contracts behind it.
                  const feeSummaryRow = slug === 'fee-taxation' && !feeDetailed;
                  const feeItems = feeSummaryRow
                    ? (data?.items ?? []).filter(it => it.periodLabel === row.periodLabel)
                    : null;
                  const items = feeSummaryRow ? feeItems : def.drilldown ? (row[def.drilldown.childKey] as unknown[] | undefined) : undefined;
                  const canDrill = slug === 'manager-performance'
                    ? true // full-page profile fetches its own paginated feed
                    : !!def.drilldown && Array.isArray(items) && items.length > 0;
                  const drillTarget = feeSummaryRow ? { ...row, items: feeItems } : row;
                  return (
                    <tr
                      key={i}
                      onClick={canDrill ? () => setDrill(drillTarget) : undefined}
                      className={`border-t border-[#f0ede8] hover:bg-[#fafaf8] ${canDrill ? 'cursor-pointer print:cursor-auto' : ''}`}>
                      {visibleColumns.map(c => {
                        // Generic row deep-link: this column links to the contract
                        // (or unit) the row represents. Unit links need a unitsBase.
                        const rl = def.rowLink;
                        const rlId = rl && c.key === rl.colKey ? row[rl.idKey] : null;
                        const rlHref = rlId == null ? null
                          : rl!.target === 'unit'
                            ? (unitsBase ?? null)
                            : `${contractsBase}/${rlId}/v2`;
                        return (
                        <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left'} text-[#1a1916]`}>
                          {rlHref ? (
                            <Link
                              href={rlHref}
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 font-medium text-[#2e9f82] hover:underline print:text-[#1a1916] print:no-underline"
                              title={rl!.target === 'unit' ? 'Open in Units' : 'Open contract'}>
                              <CellValue value={row[c.key]} type={c.type} />
                              <ExternalLink size={12} className="print:hidden" />
                            </Link>
                          ) : feeDetailed && c.key === 'contractRef' && row.contractId != null ? (
                            <Link
                              href={`${contractsBase}/${row.contractId}/v2`}
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 font-medium text-[#2e9f82] hover:underline print:text-[#1a1916] print:no-underline"
                              title="Open contract to cross-verify">
                              {String(row.contractRef ?? `CID-${row.contractId}`)}
                              <ExternalLink size={12} className="print:hidden" />
                            </Link>
                          ) : (
                            <CellValue value={row[c.key]} type={c.type} />
                          )}
                        </td>
                        );
                      })}
                      {showDrillCol && (
                        <td className="px-3 py-3 text-right text-[#c8c6c0] print:hidden">
                          {canDrill && <ChevronRight size={15} className="inline" />}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && (
        <p className="text-[11px] text-[#9b9890] mt-3 print:mt-4">
          {def.layout === 'grouped'
            ? `${groups.reduce((n, g) => n + g.items.length, 0)} ${def.drilldown?.countLabel ?? 'rows'} across ${groups.length} month${groups.length === 1 ? '' : 's'}`
            : `${sorted.length} row${sorted.length === 1 ? '' : 's'}`} · Generated {new Date(data.generatedAt).toLocaleString('en-AE')}
        </p>
      )}

      {/* Drill-down modal — lists the child items of the clicked row */}
      {def.drilldown && drill && slug !== 'manager-performance' && (() => {
        const dd = def.drilldown;
        const allItems = (drill[dd.childKey] as Record<string, unknown>[] | undefined) ?? [];
        // Kind chips: click "Deleted: 5" territory — filter the play-by-play by type.
        const filterValues = dd.filterKey
          ? [...new Set(allItems.map(it => String(it[dd.filterKey!] ?? '')).filter(Boolean))]
          : [];
        const items = drillFilter ? allItems.filter(it => String(it[dd.filterKey!]) === drillFilter) : allItems;
        const close = () => { setDrill(null); setDrillFilter(null); };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden" onClick={close}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
                <div>
                  <h3 className="text-base font-bold text-[#1a1916]">{String(drill[dd.titleKey] ?? '')}</h3>
                  <p className="text-xs text-[#6b6860] mt-0.5">
                    {items.length}{drillFilter ? ` of ${allItems.length}` : ''} {dd.countLabel}{drillFilter ? ` — ${drillFilter}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {filterValues.length > 1 && (
                    <div className="flex items-center gap-1.5 mr-1">
                      <button
                        onClick={() => setDrillFilter(null)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${!drillFilter ? 'bg-[#2e9f82] text-white border-[#2e9f82]' : 'bg-white text-[#6b6860] border-[#e3e0d9] hover:border-[#c5c2bc]'}`}>
                        All
                      </button>
                      {filterValues.map(v => (
                        <button
                          key={v}
                          onClick={() => setDrillFilter(drillFilter === v ? null : v)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border capitalize transition-colors ${drillFilter === v ? 'bg-[#2e9f82] text-white border-[#2e9f82]' : 'bg-white text-[#6b6860] border-[#e3e0d9] hover:border-[#c5c2bc]'}`}>
                          {v} · {allItems.filter(it => String(it[dd.filterKey!]) === v).length}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={close} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef]">
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890] sticky top-0">
                    <tr>
                      {dd.columns.map(c => (
                        <th key={c.key} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                      ))}
                      {dd.contractIdKey && <th className="px-3 py-2.5" aria-hidden />}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className={drillRowClass(it)}>
                        {dd.columns.map(c => (
                          <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>
                            <CellValue value={it[c.key]} type={c.type} />
                          </td>
                        ))}
                        {dd.contractIdKey && (
                          <td className="px-3 py-2.5 text-right">
                            {it[dd.contractIdKey] != null && (
                              <Link
                                href={`${contractsBase}/${it[dd.contractIdKey]}/v2`}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline"
                                title="Open contract">
                                Open <ExternalLink size={12} />
                              </Link>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Vacant units list — opened from a Vacant cell in the renewal-details matrix */}
      {vacantList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden" onClick={() => setVacantList(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
              <div>
                <h3 className="text-base font-bold text-[#1a1916]">Vacant units — {vacantList.title}</h3>
                <p className="text-xs text-[#6b6860] mt-0.5">{vacantList.units.length} vacant unit{vacantList.units.length === 1 ? '' : 's'}</p>
              </div>
              <button onClick={() => setVacantList(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef]">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto">
              {vacantList.units.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-[#9b9890]">No vacant units.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890] sticky top-0">
                    <tr>
                      <th className="px-5 py-2.5 text-left font-semibold">Unit</th>
                      <th className="px-3 py-2 text-left font-semibold">Type</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Asking rent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vacantList.units.map(u => (
                      <tr key={u.unitId} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                        <td className="px-5 py-2.5 text-left font-medium text-[#1a1916]">{u.label}</td>
                        <td className="px-3 py-2 text-left text-[#6b6860] capitalize">{(u.unitType ?? '—').replace(/_/g, ' ')}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-[#1a1916]">{u.rentFils ? fmtAed(u.rentFils) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Generic matrix cell → records popup (property×month counts, per-cheque cells) */}
      {cellModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden" onClick={() => setCellModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
              <div>
                <h3 className="text-base font-bold text-[#1a1916]">{cellModal.title}</h3>
                <p className="text-xs text-[#6b6860] mt-0.5">{cellModal.items.length} {cellModal.countLabel}{cellModal.items.length === 1 ? '' : 's'}</p>
              </div>
              <button onClick={() => setCellModal(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef]">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890] sticky top-0">
                  <tr>
                    {cellModal.columns.map(c => (
                      <th key={c.key} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                    ))}
                    {cellModal.contractIdKey && <th className="px-3 py-2.5" aria-hidden />}
                  </tr>
                </thead>
                <tbody>
                  {cellModal.items.map((it, idx) => (
                    <tr key={idx} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      {cellModal.columns.map(c => (
                        <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>
                          <CellValue value={it[c.key]} type={c.type} />
                        </td>
                      ))}
                      {cellModal.contractIdKey && (
                        <td className="px-3 py-2.5 text-right">
                          {it[cellModal.contractIdKey] != null && (
                            <Link
                              href={`${contractsBase}/${it[cellModal.contractIdKey]}/v2`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline"
                              title="Open contract">
                              Open <ExternalLink size={12} />
                            </Link>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
