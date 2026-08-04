/**
 * Shared report detail view — interactive table with sort/filter, CSV download
 * and print-friendly PDF, for EVERY report slug. Used by BOTH portals:
 *   RP:      /rental-provider/dashboard/reports/[slug]   (endpointBase /api/reports)
 *   Manager: /dashboard/manager/reports?rp=N&slug=x      (endpointBase /api/manager/reports, extraQuery rp=N)
 * One component so the two portals can never drift again.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Search, Download, Printer, Loader2, FileSpreadsheet,
  BarChart2, AlertCircle, TrendingUp, TrendingDown, Minus, ChevronRight, X, ExternalLink,
  Building2, Check, ChevronDown, Info,
} from 'lucide-react';
import { apiPatch } from '@/lib/api';
import { getReportsYear, useReportsYear, yearToRange, yearForMatrix, REPORT_YEARS } from '@/components/upnow/reportsYear';
import { ManagerPerformanceCharts, LeaseActivityCharts, ExecutiveCashflowCharts } from '@/components/upnow/ReportCharts';
import { DateRangePicker } from '@/components/upnow/DateRangePicker';
import { MemberActivityView, type MemberRow } from '@/components/upnow/MemberActivityView';

/** One line in a bounced cheque's history — mirrors ChequeEvent on the server. */
interface ChequeEvent {
  date: string | null;
  event: string;
  detail: string | null;
  amountFils: number;
  status: string | null;
}

type ReportSlug = 'portfolio' | 'lease-expiry' | 'leases-by-year' | 'contract-status' | 'renewal-pipeline' | 'renewal-forecast' | 'security-deposits' | 'executive-cashflow' | 'portfolio-overview' | 'vacancy-analysis' | 'leasing-activity' | 'lease-activity' | 'manager-performance' | 'new-leases-matrix' | 'rent-receivable' | 'payment-record' | 'cheques-management' | 'renewal-vacancy' | 'fee-taxation' | 'rent-vs-market';

interface DrilldownSpec {
  /** Row field holding the array of child items. */
  childKey: string;
  /** Child field to offer as filter chips in the modal (e.g. 'kind'). */
  filterKey?: string;
  /** Row field used for the modal title (e.g. the month label). */
  titleKey: string;
  /** CSV header for the group column (defaults to 'Month'). */
  titleLabel?: string;
  /** Singular noun for what a section IS, used in the row-count footer. Every
   *  grouped report but Rent vs Asking buckets by month, hence the default. */
  groupNoun?: string;
  /** Plural noun for the count, e.g. "leases". */
  countLabel: string;
  columns: Column[];
  /** Item field whose value is a contract id → row links to the contract. */
  contractIdKey?: string;
  /** Item field holding a truthy flag: when set, the row's link opens the
   *  Operations worklist entry rather than the lease page — the record is still
   *  being progressed there, which is where the work happens. */
  opsLinkKey?: string;
  /** When set, the lines are broken into sub-blocks under this field's value —
   *  e.g. a property sub-heading inside each month. Items must already arrive
   *  sorted by it. */
  groupByKey?: string;
  groupByLabel?: string;
  /** Columns belonging to the PARENT record (the lease) rather than the line.
   *  Printed once at the top of each block and blanked on continuation rows —
   *  the merged-cell shape the landlord's own sheet uses, so an annual rent is
   *  not repeated against every cheque on the lease. Needs `contractIdKey`.
   *  Computed at render time, so it survives filtering and sorting; the CSV
   *  export keeps every value on every row so the file stays machine-readable. */
  mergeKeys?: string[];
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
  /** Show `dataNote` behind the ⓘ instead of as a banner across the top. For a
   *  note long enough to dominate the page (Fee & VAT), the banner buries the
   *  numbers the report exists to show. */
  dataNoteInInfo?: boolean;
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
  /** Contract Status — expose the derived states (status, who has signed,
   *  cheques on file, registration) as server-side filters. */
  contractStatusFilters?: boolean;
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
  /** Group the matrix body by this row field, with a header bar and a subtotal
   *  line per group — the shape the printed sheet uses (property, then its
   *  units, then that property's line). */
  matrixGroupKey?: string;
  /** Small tables printed under the matrix — the reconciliations the sheet is
   *  meant to prove, rather than leaving the reader to do the arithmetic. */
  summaryPanels?: { title: string; note?: string; rows: { label: string; key?: string; total?: boolean; note?: string }[] }[];
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
  type?: 'aed' | 'date' | 'number' | 'bucket' | 'stage' | 'rate' | 'delta' | 'stack';
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

/** ⓘ — explanations live behind this, keeping pages executive-clean. Pass `note`
 *  to fold a report's data note in behind the same icon instead of running it as
 *  a banner across the top of the page. */
function InfoTip({ text, note, align = 'left' }: { text: string; note?: string; align?: 'left' | 'right' }) {
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
          className={`absolute z-40 top-full mt-2 ${align === 'right' ? 'right-0' : 'left-0'} ${note ? 'w-[30rem]' : 'w-80'} max-w-[80vw] max-h-[70vh] overflow-y-auto bg-white border border-[#e3e0d9] rounded-xl shadow-xl p-3.5 text-xs leading-relaxed text-[#4a4742] whitespace-normal`}
          style={{ boxShadow: '0 12px 32px rgba(20,18,15,.16)' }}>
          {text}
          {note && (
            <span className="block mt-2.5 pt-2.5 border-t border-[#eeece6] text-[#6b6860]">{note}</span>
          )}
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
    // The ceiling the month's renewals could reach — read against Annual rent it
    // is the uplift on the table.
    { key: 'marketRentFils', label: 'Market Rent', align: 'right', type: 'aed' },
    { key: 'inProgress', label: 'In progress', align: 'right', type: 'number' },
    { key: 'notStarted', label: 'Not started', align: 'right', type: 'number' },
  ],
  totals: [
    { key: 'totalLeases', label: 'Renewals', type: 'number', keep: true },
    { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
    { key: 'marketRentFils', label: 'Market Rent', type: 'aed' },
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
      // The lease on file — always the CURRENT term. A row bucketed into a future
      // month shows the term it is renewing FROM, which is the only term that
      // actually exists; the month heading carries the when.
      { key: 'term', label: 'Term' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      // Market Rent beside contracted rent = the uplift available at renewal.
      { key: 'marketRentFils', label: 'Market Rent', align: 'right', type: 'aed' },
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
    description: 'Snapshot of how each property is performing — units, occupied counts, and rent. "Market Rent" is the asking rent set on the units (units.rental_price) — a live benchmark. "Annual Rent" is the contracted rent on the books: for a leased unit, the lease running today or the next term whose cheques are already collected — a lease that has ended, been terminated, or that nobody has paid for does not count. The Occupancy filter scopes BOTH the rent figures and the units listed: Occupied (the default) = leased units only; Vacant = empty units and the hold-over rent they last let for; All = every unit summed together. Per-property occupied/vacant/total counts always show the live composition regardless of the filter. Picking a year switches Annual Rent to history — the lease that overlapped that year.',
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
    description: 'Each unit’s CURRENT (latest) lease, grouped by the month it COMMENCED within the selected year. A renewed unit is counted once — under its current lease’s start month — so the totals reconcile with the Lease Revenue report and the Portfolio page’s Annual Rent (they never double-count a unit that has renewed). Each row is a month; expand it to see the leases that began that month. Only months with a commencement are shown. The tiles show how many units’ current leases commenced and the annual rent they represent. Pick the year above.',
    endpoint: '/api/reports/leases-by-year',
    buildingLeaseFilter: true,
    layout: 'grouped',
    controlKey: 'year',
    columns: [
      { key: 'monthLabel', label: 'Commenced' },
      { key: 'leases', label: 'Leases', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'leases', label: 'Leases', type: 'number', keep: true },
      { key: 'annualRentFils', label: 'Annual rent', type: 'aed', keep: true },
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
  'contract-status': {
    title: 'Contract Status - Monthly',
    tagline: 'Your monthly contract status sheet — all twelve months in one report.',
    description: 'Every month of the selected year, the contracts turning over in it: a term COMMENCING that month (the new or renewed agreement) or a term whose renewal falls DUE that month — it ended on the last day of the month before — with nothing recorded yet. One line per unit per month; when a new agreement exists it is the line and shows its term, rent and cheques, otherwise the expiring term is shown with its rent carried over. Status reads Renewed (the agreement is executed — the lease is running, or both sides have signed), For signature (the agreement exists but is not fully signed — a customer signature with no landlord counter-signature still counts as out for signature), Pending (the cycle is up and no new agreement has been recorded) or Move-out (the customer is leaving — terminated, vacating at the end, or the renewal was rejected; no rent or cheques carry forward). Customer signed and Landlord signed are shown separately so you can see which side is holding. NO. OF PAYMENTS counts rent cheques actually on file — a payment row only counts once it carries a cheque number, so a renewal still at notice or draft stage with a generated plan and no cheques reads blank and lands in "Awaiting cheques". Contract Registration shows Completed only when the status is registered AND the certificate is on file; a cycle with no new agreement is always pending, since the expiring term\'s certificate does not register the next one. ANNUAL RENT is the month\'s whole book. COLLECTED is rent already banked on that term (cleared cheques), OVERDUE is rent whose cheque date has passed without clearing — actually owed — and UPCOMING is the rest of the term\'s cheques, dated later and not due yet (a term starting in August is paid in October, January and April, so that money is not owed in August). All three describe the term governing the cycle, never the expiring one, so a line with no agreement yet shows neither. A line still at draft or notice stage carries a proposed rent with no cheque behind it — the Awaiting cheques figure counts those. Narrow the sheet with the Year, Lease type, Property and Month filters — every figure in the month headers and the tiles is recomputed for what you filtered to.',
    endpoint: '/api/reports/contract-status',
    buildingLeaseFilter: true,
    contractStatusFilters: true,
    layout: 'grouped',
    controlKey: 'year',
    columns: [
      { key: 'monthLabel', label: 'Month' },
      { key: 'contracts', label: 'Contracts', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', align: 'right', type: 'aed' },
      { key: 'installments', label: 'Cheques', align: 'right', type: 'number' },
      { key: 'awaitingCheques', label: 'Awaiting cheques', align: 'right', type: 'number', keep: true },
      { key: 'ejariPending', label: 'Registration pending', align: 'right', type: 'number' },
      { key: 'moveOuts', label: 'Move-out', align: 'right', type: 'number' },
    ],
    totals: [
      { key: 'contracts', label: 'Contracts', type: 'number', keep: true },
      { key: 'annualRentFils', label: 'Annual rent', type: 'aed', keep: true },
      { key: 'collectedFils', label: 'Rent collected', type: 'aed', keep: true },
      { key: 'installments', label: 'Cheques on file', type: 'number', keep: true },
      { key: 'awaitingCheques', label: 'Awaiting cheques', type: 'number', keep: true },
      { key: 'signed', label: 'Signed agreements', type: 'number', keep: true },
      { key: 'customerSigned', label: 'Customer signed', type: 'number', keep: true },
      { key: 'landlordSigned', label: 'Landlord signed', type: 'number', keep: true },
      { key: 'ejariDone', label: 'Registered', type: 'number', keep: true },
      { key: 'ejariPending', label: 'Registration pending', type: 'number', keep: true },
      { key: 'nonEjari', label: 'Not registrable', type: 'number' },
      { key: 'moveOuts', label: 'Move-out', type: 'number', keep: true },
    ],
    drilldown: {
      childKey: 'items',
      titleKey: 'monthLabel',
      countLabel: 'contracts',
      contractIdKey: 'contractId',
      // Unit · customer · term ride in one stacked cell and the property is the
      // block heading, so the pipeline columns get the width.
      groupByKey: 'buildingName',
      groupByLabel: 'Property',
      opsLinkKey: 'inOperations',
      columns: [
        { key: 'lease', label: 'Unit · Customer · Term', type: 'stack' },
        { key: 'leaseType', label: 'Type', type: 'stage' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
        { key: 'collectedFils', label: 'Collected', align: 'right', type: 'aed' },
        { key: 'installments', label: 'No. of payments', align: 'right', type: 'number' },
        { key: 'signatures', label: 'Signatures', type: 'stage' },
        { key: 'stage', label: 'Stage', type: 'stage' },
        { key: 'ejari', label: 'Registration', type: 'stage' },
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

  'payment-record': {
    title: 'Payment Record - Monthly',
    tagline: 'Your monthly collections handover sheet \u2014 all twelve months in one report.',
    description: 'Every month of the selected year, the leases that COMMENCED in it and every cheque taken for them \u2014 whatever date each cheque falls due. This is why it will not agree with Cash Management or Payment Grouping, and is not meant to: those report money falling due inside a date range, this reports the paperwork collected on a month\u2019s new leases. A lease signed on 1 August sits under August even though its fees were paid in June, its first cheque is dated July and its last falls the following May. Only lines carrying a cheque number or bank reference are counted \u2014 on a handover record, no reference means nothing was physically received, which is what separates a collected cheque from a drafted payment plan. Each month header carries that month\u2019s division: leases, cheques and the split into rent, admin, registration, deposit, commission, third party and service charge. Expand a month for the individual cheques; pick the year above.',
    endpoint: '/api/reports/payment-record',
    buildingLeaseFilter: true,
    layout: 'grouped',
    controlKey: 'year',
    columns: [
      { key: 'monthLabel', label: 'Month' },
      { key: 'leases', label: 'Leases', align: 'right', type: 'number' },
      { key: 'cheques', label: 'Cheques', align: 'right', type: 'number' },
      { key: 'rentFils', label: 'Rent', align: 'right', type: 'aed' },
      { key: 'adminFils', label: 'Admin', align: 'right', type: 'aed' },
      { key: 'registrationFils', label: 'Registration', align: 'right', type: 'aed' },
      { key: 'depositFils', label: 'Security deposit', align: 'right', type: 'aed' },
      { key: 'commissionFils', label: 'Commission', align: 'right', type: 'aed' },
      { key: 'othersFils', label: 'Third party', align: 'right', type: 'aed' },
      { key: 'serviceChargeFils', label: 'Service charge', align: 'right', type: 'aed' },
      { key: 'totalFils', label: 'Total collected', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'leases', label: 'Leases', type: 'number', keep: true },
      { key: 'cheques', label: 'Cheques', type: 'number', keep: true },
      { key: 'totalFils', label: 'Total collected', type: 'aed', keep: true },
      { key: 'rentFils', label: 'Rent', type: 'aed', keep: true },
      { key: 'adminFils', label: 'Admin', type: 'aed' },
      { key: 'registrationFils', label: 'Registration', type: 'aed' },
      { key: 'depositFils', label: 'Security deposit', type: 'aed' },
      { key: 'commissionFils', label: 'Commission', type: 'aed' },
      { key: 'othersFils', label: 'Third party', type: 'aed' },
      { key: 'serviceChargeFils', label: 'Service charge', type: 'aed' },
    ],
    drilldown: {
      childKey: 'items',
      titleKey: 'monthLabel',
      countLabel: 'cheques',
      contractIdKey: 'contractId',
      filterKey: 'category',
      // Property → Annual rent describe the LEASE, so they print once per lease
      // block exactly as they do on the landlord's sheet; only the cheque
      // columns repeat down the block.
      mergeKeys: ['buildingName', 'unitLabel', 'tenantName', 'startDate', 'endDate', 'annualRentFils'],
      columns: [
        { key: 'buildingName', label: 'Property' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'startDate', label: 'Start', type: 'date' },
        { key: 'endDate', label: 'End', type: 'date' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
        { key: 'category', label: 'Payment type', type: 'stage' },
        { key: 'description', label: 'Description' },
        { key: 'installment', label: 'Installment' },
        { key: 'chequeNumber', label: 'Cheque no' },
        { key: 'chequeDate', label: 'Cheque date', type: 'date' },
        { key: 'amountFils', label: 'Amount collected', align: 'right', type: 'aed' },
      ],
    },
  },

  'rent-receivable': {
    title: 'Cash Management',
    tagline: 'Every occupied unit, every payment, no calendar cut.',
    description: 'Each occupied unit on one line, with every rent payment on its lease laid out month by month. No year is imposed \u2014 the columns run from the earliest payment to the latest one the current book holds, so a tenancy running across a new year is never cut in half. A unit counts when its lease is live: not expired or terminated, the term still running, no accepted termination in effect, and either activated or with its cheques confirmed in hand. Total is Cleared + Pending. A bounced cheque is reported in its own two columns and never added in \u2014 where a bounce was made good the replacement cheque already sits inside Cleared, so counting the bounce as well would count the money twice; a bounce nobody replaced is still owed and is shown separately so it can be added back. Click any month to see the cheques behind it, with the full history of anything that bounced.',
    endpoint: '/api/reports/rent-receivable',
    buildingLeaseFilter: true,
    dataNote: NEEDS_CHEQUE_DATA,
    layout: 'matrix',
    columns: [],
    matrixGroupKey: 'buildingName',
    summaryPanels: [
      {
        title: 'What is actually late',
        note: 'A single “outstanding” figure adds these together and reads far worse than reality. Only the first line is money to chase; Expected is cheques already held for dates that have not arrived.',
        rows: [
          { label: 'Fallen due so far', key: 'dueToDateFils' },
          { label: 'Collected against it', key: 'receivedToDateFils' },
          { label: 'Late — chase this', key: 'lateFils', total: true },
          { label: 'Expected — post-dated cheques ahead of us', key: 'notYetDueFils' },
        ],
      },
      {
        title: 'Bounced cheques',
        note: 'A bounce that was made good is reported but never added in — its replacement cheque already sits inside Cleared, so counting both would count the money twice. A bounce nobody replaced is still owed, and is added back below.',
        rows: [
          { label: 'Bounced and replaced', key: 'bouncedReplacedFils', note: 'already inside Collected — excluded' },
          { label: 'Bounced, never replaced', key: 'bouncedOwedFils', total: true, note: 'still owed — chase alongside the late rent' },
        ],
      },
      {
        title: 'Rent against cheques',
        note: 'These two should agree. What is left is a data fault on a lease, not a reporting one — a unit whose cheques do not add up to its rent.',
        rows: [
          { label: 'Annual rent contracted', key: 'annualRentFils' },
          { label: 'Total — collected + pending', key: 'totalFils' },
          { label: 'Bounced, never replaced — still owed', key: 'bouncedOwedFils' },
          { label: 'Everything receivable', key: 'receivableFils', total: true },
        ],
      },
    ],
    matrixTrailing: [
      { key: 'totalFils', label: 'Total', type: 'aed' },
      { key: 'clearedFils', label: 'Cleared', type: 'aed' },
      { key: 'pendingFils', label: 'Pending', type: 'aed' },
      { key: 'bouncedOwedFils', label: 'Bounced \u00b7 still owed', type: 'aed' },
      { key: 'bouncedReplacedFils', label: 'Bounced \u00b7 replaced', type: 'aed' },
    ],
    // Five figures, not ten. Total, both Bounced lines and Everything receivable
    // are all carried by the reconciliation panels under the table, and Pending is
    // just Late + Not yet due \u2014 so nothing is lost and the two numbers a manager
    // acts on (what is late, what is still coming) stop competing with eight others.
    totals: [
      { key: 'units', label: 'Occupied units', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
      { key: 'clearedFils', label: 'Collected', type: 'aed' },
      { key: 'lateFils', label: 'Late \u2014 chase this', type: 'aed' },
      { key: 'notYetDueFils', label: 'Expected', type: 'aed' },
    ],
  },

  'cheques-management': {
    title: 'Cheques Management',
    description: 'Every rent cheque you are currently holding. One row per earning lease — not expired or terminated, term still running, no accepted termination in effect, and either active or with its cheques confirmed in hand — showing the unit, the customer, each cheque\'s due date earliest to latest, then a column per month counting how many land in it. No year is applied: the columns run from the earliest cheque on the book to the latest, so a lease running across a new year keeps one continuous row. Rent cheques only; rent taken by bank transfer or online is reported separately underneath, and cancelled cheques are excluded. Click any month to see the cheques landing in it, with the full history of anything that bounced.',
    endpoint: '/api/reports/cheques-management',
    buildingLeaseFilter: true,
    dataNote: NEEDS_CHEQUE_DATA,
    layout: 'chequeMatrix',
    matrixGroupKey: 'buildingName',
    summaryPanels: [
      {
        title: 'How the rent arrives',
        note: 'Only the first line can appear in the grid above — the rest is rent that never becomes a cheque. Together they are every rent payment on the current book.',
        rows: [
          { label: 'Cheques in hand', key: 'valueFils', note: 'cleared + pending — a bounce is not counted here' },
          { label: 'Bank transfer', key: 'bankTransferFils' },
          { label: 'Cash / online', key: 'cashOnlineFils' },
          { label: 'Every rent payment on the book', key: 'allPaymentsFils', total: true },
        ],
      },
      {
        title: 'Against contracted rent',
        note: 'What is left is a data fault on a lease, not a reporting one — a unit whose cheques do not add up to its own rent. A bounce that was made good is deliberately absent from every figure here: its replacement cheque is already counted, and adding the bounce as well would count the same money twice.',
        rows: [
          { label: 'Every rent payment on the book', key: 'allPaymentsFils' },
          { label: 'Bounced, never replaced', key: 'bouncedOwedFils', note: 'still owed — outside the figure above' },
          { label: 'Everything receivable', key: 'receivableFils', total: true },
          { label: 'Annual rent contracted', key: 'annualRentFils' },
          { label: 'Difference', key: 'reconcileGapFils', note: 'Unit 201 — 61,100 of cheques against 60,100 of rent' },
        ],
      },
    ],
    // No controlKey at all: the schedule is every cheque on the current book and
    // the columns run from the earliest to the latest of them. A year picker cut a
    // lease's own schedule in half and hid 85 of the 325 cheques in hand.
    columns: [],
    // One row per UNIT, so a lease count would only ever restate it — and did not,
    // because a unit that changes hands mid-schedule has two leases behind one row.
    totals: [
      // Same opening pair as every other collection report: how many units, and
      // what they are contracted at. Everything after is this report's own.
      { key: 'units', label: 'Occupied units', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
      { key: 'totalCheques', label: 'Cheques in hand', type: 'number' },
      { key: 'valueFils', label: 'Cheque value', type: 'aed' },
      // Rent that never arrives as a cheque, so it can never appear in the grid
      // above. Named rather than left as a silent gap between the two figures.
      { key: 'bankTransferFils', label: 'Bank transfer', type: 'aed' },
      { key: 'cashOnlineFils', label: 'Cash / online', type: 'aed' },
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
    description: 'A property × month grid of each unit’s CURRENT (latest) lease, placed in the month it COMMENCED within the selected year. A renewed unit is counted once — under its current lease’s start month — so the totals reconcile with the Lease Revenue report and the Portfolio page’s Annual Rent (no double-counting a unit that has renewed). Each cell counts the units whose current lease began that month for the property; the trailing columns give the property’s total and the annual rent it represents. Pick the year above.',
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
    description: 'Renewal calendar per property for the selected year — every property down the side, the twelve months across the top, then Renewals · Total Vacant · Total Units. Each occupied unit is counted once, in the month its lease comes up for renewal (the day after the term ends), so the months add up to Renewals — the units renewing that year, which changes as you switch years. Total Vacant and Total Units are your current inventory (each unit’s live status) and don’t change by year, so Renewals + Total Vacant is normally less than Total Units — the gap is the occupied units whose renewal falls outside this year. Click a Vacant count to list those units.',
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
        // The lease on file — always the CURRENT term; see Renewal Plan - Monthly.
        { key: 'term', label: 'Term' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
        // Market Rent beside contracted rent = the uplift available at this
        // renewal. Same source as Rent vs Asking and the Portfolio page.
        { key: 'marketRentFils', label: 'Market Rent', align: 'right', type: 'aed' },
        // Annual rent is the CONTRACTED rent on the unit, so a renewal that is
        // only proposed shows 0 — the stage says why, and matches Renewal Plan -
        // Monthly's own Renewal column.
        { key: 'stage', label: 'Renewal', type: 'stage' },
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
    description: 'For each month of the selected year: the rent Expected (every cheque due, cancelled ones excluded), how much was Received (cleared), what is still Pending, what Bounced, the Penalty income collected, and Net Income (received rent + penalties). Anchored on the cheque date. Expected / Received up top are full-year (all 12 months, incl. post-dated cheques); YTD Expected / YTD Received are collection to date and reconcile with Cash Management. Latest lease per unit. Pick the year above.',
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
      { key: 'expectedFils', label: 'Expected (full year)', type: 'aed', keep: true },
      { key: 'receivedFils', label: 'Received (full year)', type: 'aed', keep: true },
      { key: 'ytdExpectedFils', label: 'YTD expected', type: 'aed', keep: true },
      { key: 'ytdReceivedFils', label: 'YTD received', type: 'aed', keep: true },
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
    description: 'Every unit in the portfolio against its asking price, grouped by building — rent is negotiated building by building, so that is where the uplift is actionable. Each section is one property with its unit count, what it earns and what it could; expand it for the units. Buildings run A→Z and units run in unit-number order, so you can look a unit up. Units earning nothing today sit at the foot of their building with their asking price, each stating what is outstanding on it — a renewal drafted but never proceeded ("In renewal"), a lease issued and waiting on signature or cheques ("Lease issued"), a term that has run out ("Holding over"), or simply "Vacant". "At market" is within ±5% of the asking price.',
    endpoint: '/api/reports/rent-vs-market',
    buildingLeaseFilter: true,
    dataNote: 'The benchmark is each unit\'s asking price (rental_price) as maintained on the Units page — update it there if it looks stale. Units without an asking price are listed but excluded from the uplift total. The sections list the same unit count as the Portfolio report. A unit earning nothing is not simply "vacant" — its Position is read from whatever lease is still open on it, and the row links to that lease: "In renewal" (a renewal drafted but never proceeded), "Lease issued" (issued, waiting on signature or cheques), "Holding over" (still active though its term has run out), "Lease active" (a live in-term lease on a unit its own availability flag calls vacant — a data mismatch worth fixing), "Not leased" (flagged occupied with nothing open) and "Vacant". None of them carry a gap — a vacant unit\'s asking price is lost rent, not uplift at renewal — so the uplift total stays renewal-only. The Market Price total sums the asking price across ALL units, matching the Portfolio page.',
    layout: 'grouped',
    // Section header: the building, its unit count and what it earns against
    // asking. (Count columns other than Units are left off deliberately — a
    // search recomputes every number column from the matched rows.)
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'units', label: 'Units', align: 'right', type: 'number' },
      { key: 'currentRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      { key: 'marketRentFils', label: 'Market price', align: 'right', type: 'aed' },
      { key: 'upliftFils', label: 'Uplift', align: 'right', type: 'aed' },
    ],
    drilldown: {
      childKey: 'items',
      titleKey: 'buildingName',
      titleLabel: 'Property',
      countLabel: 'units',
      groupNoun: 'building',
      contractIdKey: 'contractId',
      columns: [
        { key: 'unitLabel', label: 'Unit' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'unitType', label: 'Type', type: 'stage' },
        { key: 'currentRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
        { key: 'marketRentFils', label: 'Market price', align: 'right', type: 'aed' },
        { key: 'gapFils', label: 'Gap', align: 'right', type: 'delta' },
        { key: 'gapPct', label: 'Gap %', align: 'right', type: 'rate' },
        { key: 'position', label: 'Position', type: 'stage' },
        { key: 'leaseEnd', label: 'Lease ends', type: 'date' },
      ],
    },
    // Five figures. The question this report answers is "what am I leaving on the
    // table" — occupancy for context, how many units sit under the asking price,
    // and the three money lines. Rent compared / Earning nothing / In renewal /
    // Holding over are lease-state breakdowns, and they are already on every row
    // and in the Position badge on each unit; as tiles they only competed with the
    // uplift figure the report exists to show.
    totals: [
      { key: 'occupiedUnits', label: 'Occupied units', type: 'number' },
      { key: 'currentRentFils', label: 'Annual rent', type: 'aed' },
      { key: 'marketRentFils', label: 'Market price', type: 'aed' },
      { key: 'upliftFils', label: 'Uplift at renewal', type: 'aed' },
      { key: 'belowMarket', label: 'Below asking', type: 'number' },
    ],
  },

  'fee-taxation': {
    title: 'Fee & VAT (Taxation)',
    description: 'One-off fees, rent VAT and third-party pass-throughs, bucketed by the period each payment falls due — net, VAT and the output VAT to file. Group by quarter and the period is a VAT filing period: a lease running across a year-end splits across the quarters its cheques fall in, rather than landing wholly in the quarter it was signed. Admin & commission are VAT-able (5%); Contract Registration is exempt; rent VAT applies to commercial/industrial leases; a sub-leased building also carries the head lessor\'s levy and the 5% charged on it. Scope the period with the date range, and narrow to specific buildings or a leasing model (direct vs sub-lease).',
    endpoint: '/api/reports/fee-taxation',
    dataNoteInInfo: true,
    feeTaxationControls: true,
    controlKey: 'dateRange',
    buildingLeaseFilter: true,
    dataNote: 'Every figure is placed in the period its payment falls due (the cheque date), which is the tax point and the same basis Cash Management uses. A payment with no date falls back to its lease start. Leases are narrowed to those that can carry output VAT — a lease qualifies if it has a rent VAT rate, raises VAT cheques, or records VAT on any of its rows, so exempt residential rent stays out and appears the moment a standard-rated fee is charged on it. Switch to "Incl. exempt" to see every lease. Admin, Contract Registration and commission are the actual fee payment rows recorded on each contract (net + VAT), summed across all cheque statuses — manual overrides are reflected. Rent VAT is the contract\'s own VAT cheques where it raises them; on older contracts with VAT embedded it is annual rent × the stored VAT rate (commercial / industrial only; residential is exempt), spread across that contract\'s rent cheques so it falls due when the rent does. "Other charges" are the custom pass-throughs recorded on the contract — a sub-leased building\'s levy and service charges as net, and lines charged as tax at the standard rate ("5% VAT on sub-lease", "5% VAT on Rent") as VAT, read from the charge\'s own label. A levy worded as VAT at another rate ("20% VAT on Sublease") counts as net, not tax. Only issued/active/expired/terminated contracts are counted. Leasing model (direct vs sub-lease) is set per building — change it from the Building filter or the property form.',
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
      { key: 'otherNetFils', label: 'Other charges (net)', align: 'right', type: 'aed' },
      { key: 'otherVatFils', label: 'Other charges VAT', align: 'right', type: 'aed' },
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
      { key: 'otherNetFils', label: 'Other charges (net)', type: 'aed' },
      { key: 'otherVatFils', label: 'Other charges VAT', type: 'aed' },
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
  { key: 'otherNetFils', label: 'Other charges (net)', align: 'right', type: 'aed' },
  { key: 'otherVatFils', label: 'Other charges VAT', align: 'right', type: 'aed' },
  { key: 'totalVatFils', label: 'Total VAT', align: 'right', type: 'aed' },
];

// Reports whose rows are tenant/financial and so honour the "active tenants
// only" vs "all" scope toggle (backend ?scope=all includes ended tenants).
// Inventory / occupancy reports aren't listed — they have no ended-tenant noise.
const TENANT_SCOPED = new Set<ReportSlug>([
  'security-deposits', 'executive-cashflow',
  'leasing-activity', 'fee-taxation',
]);

// Local-date YYYY-MM-DD (no UTC shift) for the date-range control presets.
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The month an Upcoming Renewals window runs through — "Nov 2026". The backend
 *  extends every window to that month's end so the last group is never a partial
 *  month; this puts the same fact on the option the user is choosing. */
const monthEndLabel = (windowDays: number): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + windowDays);
  return new Intl.DateTimeFormat('en-AE', { month: 'short', year: 'numeric' }).format(d);
};
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
  // A fresh letting commencing this year, NOT a renewal of the sitting tenancy:
  // the unit had gone vacant and was re-let. Blue rather than the renewal green,
  // so the two read apart at a glance on the renewal calendar.
  new_lease:   'bg-[#dbeafe] text-[#1e40af]',
  // contract-status lifecycle (leases-by-year register)
  issued:      'bg-[#dbeafe] text-[#1e40af]',  // signed/issued, term not yet started
  terminated:  'bg-[#fee2e2] text-[#b91c1c]',  // ended early
  // monthly Contract Status sheet — the live Operations lane the cycle sits in
  // not_started / draft reuse the neutral greys defined above (same meaning here)
  notice_sent:        'bg-[#fef3c7] text-[#854d0e]',  // notice with the customer, awaiting acceptance
  kyc:                'bg-[#e0f2fe] text-[#0369a1]',
  payment_plan:       'bg-[#e0f2fe] text-[#0369a1]',
  cheques:            'bg-[#e0e7ff] text-[#3730a3]',
  customer_signature: 'bg-[#fef3c7] text-[#854d0e]',  // waiting on the customer
  both_signatures:    'bg-[#fef3c7] text-[#854d0e]',  // neither side has signed
  // combined Signatures cell — named by who is still outstanding ('signed' reuses
  // the blue defined above)
  // new letting vs renewal of the sitting term
  new:                'bg-[#e0f2fe] text-[#0369a1]',
  renewal:            'bg-[#ede9fe] text-[#5b21b6]',
  amendment:          'bg-[#f4f3ef] text-[#6b6860]',
  awaiting_customer:  'bg-[#fef3c7] text-[#854d0e]',
  awaiting_landlord:  'bg-[#e0e7ff] text-[#3730a3]',
  awaiting_both:      'bg-[#fee2e2] text-[#b91c1c]',
  landlord_signature: 'bg-[#e0e7ff] text-[#3730a3]',  // waiting on you
  registration:       'bg-[#e0f2fe] text-[#0369a1]',
  utility:            'bg-[#e0f2fe] text-[#0369a1]',
  move_in:            'bg-[#e0f2fe] text-[#0369a1]',
  termination:        'bg-[#fee2e2] text-[#b91c1c]',
  move_out_inspection:'bg-[#fee2e2] text-[#b91c1c]',
  bill_clearance:     'bg-[#fee2e2] text-[#b91c1c]',
  settlement:         'bg-[#fee2e2] text-[#b91c1c]',
  in_progress:        'bg-[#f4f3ef] text-[#6b6860]',
  ready_to_activate:  'bg-[#dbeafe] text-[#1e40af]',
  // monthly Contract Status sheet — the cycle's state and its registration
  for_signature:  'bg-[#dbeafe] text-[#1e40af]',  // new agreement out, not signed yet
  move_out:       'bg-[#fee2e2] text-[#b91c1c]',  // customer leaving — nothing carries forward
  completed:      'bg-[#dcfce7] text-[#166534]',  // Contract Registration done (certificate on file)
  not_applicable: 'bg-[#f4f3ef] text-[#6b6860]',  // registration doesn't apply to this contract
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
  below_market: 'bg-[#fee2e2] text-[#b91c1c]',  // rent under market → red
  at_market:    'bg-[#f4f3ef] text-[#6b6860]',  // within ±5% → neutral
  above_market: 'bg-[#d8f2e8] text-[#1a7a5a]',  // rent over market → green
  no_benchmark: 'bg-[#f4f3ef] text-[#6b6860]',  // no market price set
  vacant:       'bg-[#fef3c7] text-[#854d0e]',  // amber — earning nothing
  not_leased:   'bg-[#fef3c7] text-[#854d0e]',  // occupied flag, no counting lease
  // …and why it earns nothing: the work outstanding on the unit's open lease.
  in_renewal:   'bg-[#e0e7ff] text-[#3730a3]',  // indigo — renewal drafted, not proceeded
  draft_lease:  'bg-[#e0e7ff] text-[#3730a3]',  // indigo — new lease drafted
  lease_issued: 'bg-[#dbeafe] text-[#1e40af]',  // blue — awaiting signature / cheques
  lease_active: 'bg-[#dbeafe] text-[#1e40af]',  // live lease, unit flagged vacant
  holding_over: 'bg-[#fee2e2] text-[#b91c1c]',  // red — term ran out, still active
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
    // gapFils = market − current: positive = below market (red, down), negative = above market (green, up)
    if (v === 0) return <span className="text-[#6b6860] inline-flex items-center gap-1"><Minus size={11} /> {fmtAed(0)}</span>;
    return v > 0
      ? <span className="text-red-600 inline-flex items-center gap-1"><TrendingDown size={11} /> {fmtAed(Math.abs(v))}</span>
      : <span className="text-[#1a7a5a] inline-flex items-center gap-1"><TrendingUp size={11} /> {fmtAed(Math.abs(v))}</span>;
  }
  // Several fields folded into one cell — newline-separated, first line leads.
  if (type === 'stack') {
    const lines = String(value).split('\n').filter(Boolean);
    return (
      <span className="block leading-snug">
        <span className="block font-medium text-[#1a1916]">{lines[0]}</span>
        {lines.slice(1).map((l, i) => (
          <span key={i} className={`block ${i === 0 ? 'text-[#4a4742]' : 'text-[11px] text-[#9b9890]'}`}>{l}</span>
        ))}
      </span>
    );
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
  const pathname = usePathname();
  const sp = useSearchParams();
  const slug = slugProp as ReportSlug;
  const def = REPORTS[slug];

  const [data, setData] = useState<{ generatedAt: string; totals: Record<string, number>; rows: Record<string, unknown>[]; windowDays?: number; months?: string[]; monthKeys?: string[]; currentMonth?: string; columnTotals?: number[]; maxCheques?: number; year?: number; buildings?: BuildingOption[]; unitTypes?: string[]; items?: Record<string, unknown>[]; availableYears?: number[] } | null>(null);
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
  const [leaseStatus, setLeaseStatus] = useState<'active' | 'expired' | 'terminated' | 'all'>(
    () => (sp?.get('status') === 'active' ? 'active' : sp?.get('status') === 'expired' ? 'expired' : sp?.get('status') === 'terminated' ? 'terminated' : 'all'),
  );
  // Occupancy segment (portfolio): Occupied · Vacant · All. Defaults to Occupied
  // (occupied units' in-place rent + records only); Vacant = empty units' hold-over;
  // All = every unit summed together. The param is always sent so 'all' is explicit.
  const [occupancy, setOccupancy] = useState<'all' | 'occupied' | 'vacant'>(
    () => (sp?.get('occupancy') === 'all' ? 'all' : sp?.get('occupancy') === 'vacant' ? 'vacant' : 'occupied'),
  );
  // Contract Status: the derived states as filters (status / who has signed /
  // cheques on file / registration). All default to 'all' and are only sent when
  // narrowed, so a bare link always shows the whole sheet.
  const [csStatus, setCsStatus] = useState<string>(() => sp?.get('cstatus') ?? 'all');
  const [csSignature, setCsSignature] = useState<string>(() => sp?.get('signature') ?? 'all');
  const [csCheques, setCsCheques] = useState<string>(() => sp?.get('cheques') ?? 'all');
  const [csRegistration, setCsRegistration] = useState<string>(() => sp?.get('registration') ?? 'all');
  const [csStage, setCsStage] = useState<string>(() => sp?.get('stage') ?? 'all');
  const [csMonth, setCsMonth] = useState<string>(() => sp?.get('month') ?? 'all');
  const [drill, setDrill] = useState<Record<string, unknown> | null>(null);
  const [drillFilter, setDrillFilter] = useState<string | null>(null);
  const [vacantList, setVacantList] = useState<{ title: string; units: VacantUnit[] } | null>(null);
  // Generic matrix cell → records popup (property×month counts, per-cheque cells).
  const [cellModal, setCellModal] = useState<{ title: string; countLabel: string; columns: Column[]; contractIdKey?: string; items: Record<string, unknown>[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Fee-taxation building + leasing-model filters. [] buildings = all; lease
  // types default to both selected (= all). Inline reclassify bumps refreshTick
  // to refetch so the rows reflect the building's new leasing model.
  // Seeded from the address so a refresh restores the property / leasing-model
  // choice along with the rest of the filters.
  const [selectedBuildings, setSelectedBuildings] = useState<number[]>(
    () => (sp?.get('buildings') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0),
  );
  const [selectedLeaseTypes, setSelectedLeaseTypes] = useState<LeaseType[]>(() => {
    const raw = (sp?.get('leaseTypes') ?? '').split(',').filter(Boolean) as LeaseType[];
    const picked = raw.filter(t => (ALL_LEASE_TYPES as readonly string[]).includes(t));
    return picked.length ? picked : [...ALL_LEASE_TYPES];
  });
  const [buildingMenuOpen, setBuildingMenuOpen] = useState(false);
  const [classifyingId, setClassifyingId] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const buildingMenuRef = useRef<HTMLDivElement>(null);
  // Fee-taxation: view (per-period summary vs per-contract detail) + bucketing
  // granularity (year vs quarter). View is client-only — one fetch returns both
  // rows + items; granularity re-buckets server-side so it refetches.
  const [feeView, setFeeView] = useState<'overall' | 'detailed'>('overall');
  const [granularity, setGranularity] = useState<'year' | 'quarter'>(() => (sp?.get('groupBy') === 'quarter' ? 'quarter' : 'year'));
  // Fee & VAT only: hide exempt leases (the default) or include them.
  const [vatScope, setVatScope] = useState<'applicable' | 'all'>(() => (sp?.get('vatScope') === 'all' ? 'all' : 'applicable'));
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
      // Likewise the VAT scope — the backend already defaults to applicable-only,
      // so only the explicit "all" needs sending.
      if (def.feeTaxationControls && vatScope === 'all') extra.set('vatScope', 'all');
      const s = extra.toString();
      if (s) url += (url.includes('?') ? '&' : '?') + s;
    }
    // Tenant scope — only the tenant/financial reports honour it; default is
    // active-only on the backend, so only the explicit "all" needs sending.
    if (TENANT_SCOPED.has(slug) && scope === 'all') url += (url.includes('?') ? '&' : '?') + 'scope=all';
    // Unit type filter (Unit Mix).
    if (def.unitTypeFilter && unitTypeSel) url += (url.includes('?') ? '&' : '?') + 'unitType=' + encodeURIComponent(unitTypeSel);
    if (def.leaseStatusFilter && leaseStatus !== 'all') url += (url.includes('?') ? '&' : '?') + 'status=' + leaseStatus;
    if (def.occupancyFilter) url += (url.includes('?') ? '&' : '?') + 'occupancy=' + occupancy;
    if (def.contractStatusFilters) {
      const st = new URLSearchParams();
      if (csStatus !== 'all') st.set('cstatus', csStatus);
      if (csSignature !== 'all') st.set('signature', csSignature);
      if (csCheques !== 'all') st.set('cheques', csCheques);
      if (csRegistration !== 'all') st.set('registration', csRegistration);
      if (csStage !== 'all') st.set('stage', csStage);
      if (csMonth !== 'all') st.set('month', csMonth);
      const q = st.toString();
      if (q) url += (url.includes('?') ? '&' : '?') + q;
    }
    if (extraQuery) url += (url.includes('?') ? '&' : '?') + extraQuery;
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [def, slug, leaseWindow, forecastMonths, from, to, year, scope, unitTypeSel, leaseStatus, occupancy, csStatus, csSignature, csCheques, csRegistration, csStage, csMonth, endpointBase, extraQuery, selectedBuildings, selectedLeaseTypes, granularity, vatScope, refreshTick]);

  // Keep the chosen filters in the URL. A refresh — or a link pasted to someone
  // else — then lands on the same view instead of resetting to the default. Only
  // narrowed values are written, so a clean report keeps a clean address.
  useEffect(() => {
    if (!def?.contractStatusFilters || !pathname) return;
    const qs = new URLSearchParams();
    if (csMonth !== 'all') qs.set('month', csMonth);
    if (csStatus !== 'all') qs.set('cstatus', csStatus);
    if (csStage !== 'all') qs.set('stage', csStage);
    if (csSignature !== 'all') qs.set('signature', csSignature);
    if (csCheques !== 'all') qs.set('cheques', csCheques);
    if (csRegistration !== 'all') qs.set('registration', csRegistration);
    if (def.controlKey === 'year') qs.set('year', String(year));
    if (selectedBuildings.length) qs.set('buildings', selectedBuildings.join(','));
    if (selectedLeaseTypes.length > 0 && selectedLeaseTypes.length < ALL_LEASE_TYPES.length)
      qs.set('leaseTypes', selectedLeaseTypes.join(','));
    const next = qs.toString();
    if (next === (sp?.toString() ?? '')) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [def, pathname, router, sp, year, csMonth, csStatus, csStage, csSignature, csCheques, csRegistration, selectedBuildings, selectedLeaseTypes]);

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
  // A report may declare which years actually have data (availableYears); when it
  // does, the year picker shows only those (empty years never appear). Reports
  // that don't declare it keep their full static range (below, per picker).
  const dataYears = data?.availableYears && data.availableYears.length ? data.availableYears : null;
  // If the selected year has no data (e.g. a stored 2024 on a data-scoped report),
  // snap to the latest year that does, so the view isn't confusingly empty.
  useEffect(() => {
    if (def.controlKey === 'year' && dataYears && !dataYears.includes(year)) {
      setYear(dataYears[dataYears.length - 1]);
    }
  }, [dataYears, def.controlKey, year]);
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
        // The sub-group value (e.g. the property) is a heading, not a column —
        // search it too, or filtering by building would find nothing.
        const searchKeys = [...dd.columns.map(c => c.key), ...(dd.groupByKey ? [dd.groupByKey] : [])];
        const matched = !needle ? items : items.filter(it =>
          searchKeys.some(k => String(it[k] ?? '').toLowerCase().includes(needle)));
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

  // Cash Management matrix: when a search needle or the property dropdown narrows
  // the visible units, the footer (per-month + grand total), the KPI tiles, the
  // reconciliation panels and the CSV "Total" row must all reflect the rows shown.
  // Every figure is recomputed by the SAME rule the server uses, so a filtered
  // sheet reconciles exactly as the unfiltered one does — including the
  // late/not-yet-due split, which depends on where the current month falls.
  const matrixView = useMemo(() => {
    if (def.layout !== 'matrix' || !data) return null;
    const monthCount = (data.months ?? []).length;
    if (!search.trim() && !propertyFilter) return { columnTotals: data.columnTotals ?? [], totals: data.totals };
    const colTotals = new Array(monthCount).fill(0);
    const sum = (k: string) => sorted.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    // Distinct UNITS, not rows — a unit re-let mid-schedule contributes two rows.
    const unitKeys = new Set<string>();
    // What has fallen due against what cleared on it: cells up to and including
    // the current Dubai month, cleared cheques only — the server's own rule.
    const monthKeys = data.monthKeys ?? [];
    const thisMonth = data.currentMonth ?? '';
    let dueToDate = 0, receivedToDate = 0;
    sorted.forEach(row => {
      unitKeys.add(row.unitId != null
        ? `u${String(row.unitId)}`
        : `${String(row.buildingName ?? '')}|${String(row.unitLabel ?? row.contractId)}`);
      const cells = (row.cells as { amountFils: number; cheques?: { amountFils: number; status: string | null }[] }[] | undefined) ?? [];
      cells.forEach((c, ci) => {
        if (ci < monthCount) colTotals[ci] += Number(c.amountFils) || 0;
        if (thisMonth && monthKeys[ci] && monthKeys[ci] > thisMonth) return;
        dueToDate += Number(c.amountFils) || 0;
        for (const q of c.cheques ?? []) if (q.status === 'cleared') receivedToDate += Number(q.amountFils) || 0;
      });
    });
    const totalFils = sum('totalFils');
    const bouncedOwedFils = sum('bouncedOwedFils');
    const totals: Record<string, number> = {
      units: unitKeys.size,
      annualRentFils: sum('annualRentFils'),
      totalFils,
      clearedFils: sum('clearedFils'),
      pendingFils: sum('pendingFils'),
      bouncedOwedFils,
      bouncedReplacedFils: sum('bouncedReplacedFils'),
      // What reconciles against contracted rent: a bounce nobody replaced is
      // still owed and sits outside Total.
      receivableFils: totalFils + bouncedOwedFils,
      dueToDateFils: dueToDate,
      receivedToDateFils: receivedToDate,
      lateFils: dueToDate - receivedToDate,
      notYetDueFils: totalFils - dueToDate,
    };
    // Any trailing column the report declares that isn't one of the above.
    for (const c of def.matrixTrailing ?? []) if (!(c.key in totals)) totals[c.key] = sum(c.key);
    return { columnTotals: colTotals, totals };
  }, [def.layout, def.matrixTrailing, data, search, sorted, propertyFilter]);

  // One matrix row. Extracted so the grouped body (property bar → units →
  // subtotal) and the flat body render identically instead of drifting.
  const renderMatrixRow = (row: Record<string, unknown>, rowKey: string) => {
    const cells = (row.cells as { amountFils: number; status: string | null; chequeNumber?: string | null; dueDate?: string | null; chequeCount?: number; cheques?: Record<string, unknown>[] }[]) ?? [];
    // Grouped sheets print the property in the group bar and the term is not what
    // the row is about, so the cell carries the unit alone — "Shed-5", not
    // "Unit Shed-5 / Avenue Warehouse / 1 Feb 2026 – 31 Jan 2027". The term still
    // reaches the reader as the link title. Ungrouped reports keep all three lines.
    const bare = Boolean(def.matrixGroupKey);
    const label = String(row.unitLabel ?? '—').replace(/^Unit\s+/i, '');
    const term = [row.contractStartDate, row.contractEndDate].every(Boolean)
      ? `${fmtDate(row.contractStartDate as string)} – ${fmtDate(row.contractEndDate as string)}`
      : '';
    return (
      <tr key={rowKey} className="border-t border-[#f0ede8] hover:bg-[#fafaf8] print:break-inside-avoid">
        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-left">
          {row.contractId != null ? (
            <Link href={`${contractsBase}/${row.contractId}/v2`} className="font-medium text-[#2e9f82] leading-tight inline-flex items-center gap-1 hover:underline print:text-[#1a1916] print:no-underline" title={bare && term ? `${String(row.unitLabel ?? '')} · ${term}` : 'Open contract'}>
              {bare ? label : String(row.unitLabel ?? '—')}<ExternalLink size={11} className="print:hidden" />
            </Link>
          ) : (
            <div className="font-medium text-[#1a1916] leading-tight">{bare ? label : String(row.unitLabel ?? '—')}</div>
          )}
          {!bare && <div className="text-[11px] text-[#9b9890] leading-tight">{String(row.buildingName ?? '')}</div>}
          {!bare && Boolean(row.contractStartDate || row.contractEndDate) && (
            <div className="text-[11px] text-[#9b9890] leading-tight">
              {fmtDate(row.contractStartDate as string)} – {fmtDate(row.contractEndDate as string)}
            </div>
          )}
        </td>
        {/* Annual rent belongs to the unit's CURRENT lease. A lease
            superseded during the year still lists its cash, but a
            figure here would double-count the unit — so it reads as
            a dash with the reason on hover. */}
        <td className="px-3 py-2 text-right tabular-nums text-[#1a1916] whitespace-nowrap border-l border-[#f0ede8]">
          {row.isCurrentLease === false
            ? <span className="text-[#9b9890]" title="Superseded during the year — annual rent sits on this unit's current lease">—</span>
            : fmtAmt(Number(row.annualRentFils))}
        </td>
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
                    { key: 'replacement', label: 'Replacement' },
                  ],
                  // Every payment in the cell. This used to synthesise ONE
                  // row from the cell summary — the first cheque's number
                  // and date against the COMBINED amount, a payment that
                  // never existed wherever two cheques shared a month.
                  items: (c.cheques ?? []).length
                    ? (c.cheques as Record<string, unknown>[])
                    : [{ chequeNumber: c.chequeNumber ?? null, dueDate: c.dueDate ?? null, amountFils: c.amountFils, status: c.status }],
                })}
                className="hover:underline cursor-pointer print:no-underline"
                title="See the cheque behind this amount">
                {fmtAmt(c.amountFils)}{c.chequeCount && c.chequeCount > 1 ? ` (${c.chequeCount})` : ''}
              </button>
            ) : fmtAmt(c.amountFils)}
          </td>
        ))}
        {def.matrixTrailing ? def.matrixTrailing.map((c, ci) => (
          <td key={c.key} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${ci === 0 ? 'font-bold text-[#1a1916]' : 'text-[#1a1916]'} ${ci < (def.matrixTrailing!.length - 1) ? 'border-l border-[#f0ede8]' : ''}`}>
            {c.type === 'number' ? fmtNumber(Number(row[c.key])) : fmtAmt(Number(row[c.key]))}
          </td>
        )) : (<>
        <td className="px-3 py-2 text-right tabular-nums font-bold text-[#1a1916] whitespace-nowrap border-l border-[#f0ede8]">{fmtAmt(Number(row.totalFils))}</td>
        <td className="px-3 py-2 text-right tabular-nums text-[#1a1916] whitespace-nowrap border-l border-[#f0ede8]">{fmtAmt(Number(row.ytdExpectedFils))}</td>
        <td className="px-3 py-2 text-right tabular-nums font-medium text-[#15803d] whitespace-nowrap">{fmtAmt(Number(row.ytdReceivedFils))}</td>
        </>)}
      </tr>
    );
  };

  /** One cheque-schedule row. Shared by the grouped and flat bodies so the two
   *  can never drift apart. */
  const renderChequeRow = (row: Record<string, unknown>, rowKey: string) => {
                  const dates = (row.chequeDates as string[]) ?? [];
                  const counts = (row.monthCounts as number[]) ?? [];
                  const cheques = (row.cheques as { chequeNumber: string | null; dueDate: string | null; amountFils: number; status: string | null; monthIndex: number }[] | undefined) ?? [];
                  return (
                    <tr key={rowKey} className="border-t border-[#f0ede8] hover:bg-[#fafaf8] print:break-inside-avoid">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-left whitespace-nowrap">
                        {/* Property is in the group bar and the term is not what the
                            row is about — the cell carries the unit alone, with the
                            full label and term on hover. */}
                        {Number(row.contractId) > 0 ? (
                          <Link href={`${contractsBase}/${row.contractId}/v2`} className="text-[13px] font-semibold text-[#2e9f82] leading-tight inline-flex items-center gap-1 hover:underline print:text-[#1a1916] print:no-underline"
                            title={`${String(row.unitLabel ?? '')}${row.contractStartDate ? ` · ${fmtDate(row.contractStartDate as string)} – ${fmtDate(row.contractEndDate as string)}` : ''}`}>
                            {String(row.unitLabel ?? '—').replace(/^Unit\s+/i, '')}<ExternalLink size={11} className="print:hidden" />
                          </Link>
                        ) : (
                          <div className="text-[13px] font-semibold text-[#1a1916] leading-tight">{String(row.unitLabel ?? '—').replace(/^Unit\s+/i, '')}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-left text-[#6b6860] whitespace-nowrap">{String(row.customer ?? '—')}</td>
                      {Array.from({ length: data?.maxCheques ?? 0 }, (_, ci) => {
                        // Each cheque opens its own detail: number, due date, amount,
                        // status, and — if it bounced — what settled it and when.
                        const chq = cheques[ci];
                        return (
                        <td key={ci} className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${ci === 0 ? 'border-l border-[#f0ede8]' : ''} ${dates[ci] ? (CELL_STATUS_STYLE[chq?.status ?? ''] ?? 'text-[#1a1916]') : 'text-[#d4d2cc]'}`}>
                          {dates[ci] && chq ? (
                            <button
                              type="button"
                              onClick={() => setCellModal({
                                title: `${String(row.unitLabel ?? '').replace(/^Unit\s+/i, '')} · cheque ${ci + 1} of ${dates.length}`,
                                countLabel: 'cheque',
                                columns: [
                                  { key: 'chequeNumber', label: 'Cheque #' },
                                  { key: 'dueDate', label: 'Due', type: 'date' },
                                  { key: 'amountFils', label: 'Amount', align: 'right', type: 'aed' },
                                  { key: 'status', label: 'Status', type: 'stage' },
                                  { key: 'replacement', label: 'Replacement' },
                                ],
                                items: [chq as unknown as Record<string, unknown>],
                              })}
                              className="hover:underline cursor-pointer print:no-underline"
                              title="See this cheque">
                              {dates[ci]}
                            </button>
                          ) : (dates[ci] ?? '·')}
                        </td>
                        );
                      })}
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
  };

  // Cheque-schedule matrix: per-month cheque counts and total are always
  // recomputed from the visible rows, so the footer + tiles follow the property
  // filter and search without a refetch.
  const chequeView = useMemo(() => {
    if (def.layout !== 'chequeMatrix' || !data) return null;
    // Columns run the length of the book now, not a fixed twelve.
    const nMonths = (data.months ?? []).length;
    const colTotals = new Array(nMonths).fill(0);
    const colValue = new Array(nMonths).fill(0);
    let totalCheques = 0, valueFils = 0, clearedFils = 0, pendingFils = 0, bouncedFils = 0;
    let bouncedReplacedFils = 0, bouncedOwedFils = 0;
    const unitIds = new Set<number>();
    sorted.forEach(row => {
      const mc = (row.monthCounts as number[] | undefined) ?? [];
      mc.forEach((n, i) => { if (i < nMonths) colTotals[i] += Number(n) || 0; });
      const mv = (row.monthValueFils as number[] | undefined) ?? [];
      mv.forEach((n, i) => { if (i < nMonths) colValue[i] += Number(n) || 0; });
      totalCheques += Number(row.totalCheques ?? 0);
      valueFils += Number(row.valueFils ?? 0);
      clearedFils += Number(row.clearedFils ?? 0);
      pendingFils += Number(row.pendingFils ?? 0);
      bouncedFils += Number(row.bouncedFils ?? 0);
      bouncedReplacedFils += Number(row.bouncedReplacedFils ?? 0);
      bouncedOwedFils += Number(row.bouncedOwedFils ?? 0);
      if (row.unitId != null) unitIds.add(Number(row.unitId));
    });
    return {
      columnTotals: colTotals,
      columnValueFils: colValue,
      // Annual rent and the bridge lines are properties of the whole book, not of
      // the rows on screen, so they come straight from the server — filtering to
      // one property must not restate the landlord's contracted rent.
      totals: {
        leases: sorted.length, units: unitIds.size, totalCheques,
        valueFils, clearedFils, pendingFils, bouncedFils,
        annualRentFils: Number(data.totals?.annualRentFils ?? 0),
        bankTransferFils: Number(data.totals?.bankTransferFils ?? 0),
        cashOnlineFils: Number(data.totals?.cashOnlineFils ?? 0),
        otherMeansFils: Number(data.totals?.otherMeansFils ?? 0),
        cancelledFils: Number(data.totals?.cancelledFils ?? 0),
        bouncedReplacedFils: bouncedReplacedFils || Number(data.totals?.bouncedReplacedFils ?? 0),
        bouncedOwedFils: bouncedOwedFils || Number(data.totals?.bouncedOwedFils ?? 0),
        // Derived here so the note states the arithmetic rather than asserting it.
        allPaymentsFils: valueFils + Number(data.totals?.otherMeansFils ?? 0),
        receivableFils: valueFils + Number(data.totals?.otherMeansFils ?? 0)
          + (bouncedOwedFils || Number(data.totals?.bouncedOwedFils ?? 0)),
        reconcileGapFils: valueFils + Number(data.totals?.otherMeansFils ?? 0)
          + (bouncedOwedFils || Number(data.totals?.bouncedOwedFils ?? 0))
          - Number(data.totals?.annualRentFils ?? 0),
      } as Record<string, number>,
    };
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
      // A stacked cell would break the row across lines in a spreadsheet.
      if (type === 'stack') return raw == null ? '' : String(raw).split('\n').join(' · ');
      return raw ?? '';
    };

    // Money cell for a column whose `type` decides the unit: fils → AED with two
    // decimals, a count left as a count.
    const fmtByType = (c: { type?: string }, v: unknown) =>
      c.type === 'number' ? String(Number(v) || 0) : ((Number(v) || 0) / 100).toFixed(2);

    // Split the visible rows into the property blocks the sheet is grouped into,
    // in the order they appear on screen. Empty when the report isn't grouped.
    const matrixGroups = () => {
      const key = def.matrixGroupKey;
      const order: string[] = [];
      const map = new Map<string, Record<string, unknown>[]>();
      if (!key) return { order, map };
      for (const r of sorted) {
        const g = String(r[key] ?? '—');
        if (!map.has(g)) { map.set(g, []); order.push(g); }
        map.get(g)!.push(r);
      }
      return { order, map };
    };

    // The reconciliation panels printed under the sheet — the arithmetic the
    // report exists to prove ("what is actually late", "rent against cheques").
    // Appended after a blank line so the grid above stays a clean rectangle.
    const panelRows = (): string[][] => {
      if (!def.summaryPanels) return [];
      const view = matrixView ?? chequeView;
      const out: string[][] = [[]];
      for (const panel of def.summaryPanels) {
        out.push([panel.title]);
        for (const r of panel.rows) {
          const v = r.key ? (view?.totals?.[r.key] ?? data.totals?.[r.key]) : undefined;
          out.push([r.label, v == null ? '' : (Number(v) / 100).toFixed(2)]);
        }
        out.push([]);
      }
      return out;
    };

    // Matrix layout (Cash Management): the sheet as it reads on screen — each
    // property block with its own subtotal, the grand total, the cumulative line
    // and the reconciliation panels. The trailing columns are the report's own
    // `matrixTrailing`, so the file can never drift from the page again.
    if (def.layout === 'matrix') {
      const months = data.months ?? [];
      const trailing = def.matrixTrailing ?? [
        { key: 'totalFils', label: 'Total' },
        { key: 'ytdExpectedFils', label: 'YTD Expected' },
        { key: 'ytdReceivedFils', label: 'YTD Received' },
      ];
      const headers = ['Property', 'Unit', 'Customer', 'Start', 'End', 'Annual rent', ...months, ...trailing.map(c => c.label)];
      const lineFor = (row: Record<string, unknown>) => {
        const cells = (row.cells as { amountFils: number }[]) ?? [];
        return [
          String(row.buildingName ?? ''),
          String(row.unitLabel ?? ''),
          String(row.customer ?? ''),
          row.contractStartDate ? String(row.contractStartDate) : '',
          row.contractEndDate ? String(row.contractEndDate) : '',
          ((Number(row.annualRentFils) || 0) / 100).toFixed(2),
          ...months.map((_, i) => ((Number(cells[i]?.amountFils) || 0) / 100).toFixed(2)),
          ...trailing.map(c => fmtByType(c, row[c.key])),
        ];
      };
      const subtotalFor = (label: string, group: Record<string, unknown>[]) => {
        const cols = new Array(months.length).fill(0);
        for (const r of group) {
          ((r.cells as { amountFils: number }[]) ?? []).forEach((c, i) => {
            if (i < months.length) cols[i] += Number(c.amountFils) || 0;
          });
        }
        const add = (k: string) => group.reduce((a, r) => a + (Number(r[k]) || 0), 0);
        return [
          label, '', '', '', '',
          (add('annualRentFils') / 100).toFixed(2),
          ...cols.map(t => (t / 100).toFixed(2)),
          ...trailing.map(c => fmtByType(c, add(c.key))),
        ];
      };
      const rows: string[][] = [];
      const { order, map } = matrixGroups();
      if (order.length) {
        for (const g of order) {
          rows.push(...map.get(g)!.map(lineFor));
          rows.push(subtotalFor(`${g} subtotal`, map.get(g)!));
        }
      } else {
        rows.push(...sorted.map(lineFor));
      }
      const t = matrixView?.totals ?? data.totals ?? {};
      const colTotals = matrixView?.columnTotals ?? data.columnTotals ?? [];
      rows.push([
        'Total', '', '', '', '',
        ((Number(t.annualRentFils) || 0) / 100).toFixed(2),
        ...colTotals.map(v => ((Number(v) || 0) / 100).toFixed(2)),
        ...trailing.map(c => fmtByType(c, t[c.key])),
      ]);
      // Cumulative — running total of the monthly column totals.
      let csvRun = 0;
      rows.push([
        'Cumulative', '', '', '', '', '',
        ...colTotals.map(v => ((csvRun += Number(v) || 0) / 100).toFixed(2)),
        ...trailing.map(() => ''),
      ]);
      rows.push(...panelRows());
      downloadCsv(`${slug}-${data.year ?? datestamp}.csv`, headers, rows);
      return;
    }

    // Cheque-schedule matrix: property + unit + customer, one column per cheque
    // date (up to the widest lease), a column per month (cheque count), the total
    // count and the face value behind it — with the same property subtotals and
    // reconciliation panels the page shows.
    if (def.layout === 'chequeMatrix') {
      const months = data.months ?? [];
      const maxCheques = data.maxCheques ?? 0;
      const chequeCols = Array.from({ length: maxCheques }, (_, i) => `Cheque ${i + 1}`);
      // The money behind the counts. It is on every row and the tiles quote it,
      // so a schedule exported without it can't be reconciled against anything.
      const valueCols = [
        { key: 'valueFils', label: 'Cheque value' },
        { key: 'clearedFils', label: 'Cleared' },
        { key: 'pendingFils', label: 'Pending' },
        { key: 'bouncedOwedFils', label: 'Bounced · still owed' },
        { key: 'bouncedReplacedFils', label: 'Bounced · replaced' },
      ];
      const headers = ['Property', 'Unit', 'Customer', 'Start', 'End', ...chequeCols, ...months, 'Total cheques', ...valueCols.map(c => c.label)];
      const lineFor = (row: Record<string, unknown>) => {
        const dates = (row.chequeDates as string[]) ?? [];
        const counts = (row.monthCounts as number[]) ?? [];
        return [
          String(row.buildingName ?? ''),
          String(row.unitLabel ?? ''),
          String(row.customer ?? ''),
          row.contractStartDate ? String(row.contractStartDate) : '',
          row.contractEndDate ? String(row.contractEndDate) : '',
          ...Array.from({ length: maxCheques }, (_, i) => dates[i] ?? ''),
          ...months.map((_, i) => String(Number(counts[i]) || 0)),
          String(Number(row.totalCheques) || 0),
          ...valueCols.map(c => ((Number(row[c.key]) || 0) / 100).toFixed(2)),
        ];
      };
      const subtotalFor = (label: string, group: Record<string, unknown>[]) => {
        const cols = new Array(months.length).fill(0);
        for (const r of group) {
          ((r.monthCounts as number[]) ?? []).forEach((n, i) => { if (i < months.length) cols[i] += Number(n) || 0; });
        }
        const add = (k: string) => group.reduce((a, r) => a + (Number(r[k]) || 0), 0);
        return [
          label, '', '', '', '',
          ...Array.from({ length: maxCheques }, () => ''),
          ...cols.map(n => String(n)),
          String(add('totalCheques')),
          ...valueCols.map(c => (add(c.key) / 100).toFixed(2)),
        ];
      };
      const rows: string[][] = [];
      const { order, map } = matrixGroups();
      if (order.length) {
        for (const g of order) {
          rows.push(...map.get(g)!.map(lineFor));
          rows.push(subtotalFor(`${g} subtotal`, map.get(g)!));
        }
      } else {
        rows.push(...sorted.map(lineFor));
      }
      const t = chequeView?.totals ?? data.totals ?? {};
      rows.push([
        'Total', '', '', '', '',
        ...Array.from({ length: maxCheques }, () => ''),
        ...(chequeView?.columnTotals ?? data.columnTotals ?? []).map(v => String(Number(v) || 0)),
        String(Number(t.totalCheques) || 0),
        ...valueCols.map(c => ((Number(t[c.key]) || 0) / 100).toFixed(2)),
      ]);
      rows.push(...panelRows());
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

    // Grouped layout: one row per child lease, prefixed with its group — then the
    // section headings themselves. The month/property bar carries figures no
    // detail line holds (awaiting cheques, registration pending, move-outs …),
    // so a file with only the detail loses half of what the page states.
    if (def.layout === 'grouped' && def.drilldown) {
      const dd = def.drilldown;
      const headers = [
        dd.titleLabel ?? 'Month',
        ...(dd.groupByKey ? [dd.groupByLabel ?? 'Group'] : []),
        ...dd.columns.map(c => c.label),
      ];
      const rows: string[][] = groups.flatMap(g =>
        g.items.map(it => [
          String(g.row[dd.titleKey] ?? ''),
          ...(dd.groupByKey ? [String(it[dd.groupByKey] ?? '')] : []),
          ...dd.columns.map(c => String(fmtCell(it[c.key], c.type))),
        ]),
      );
      // Section summary, exactly the columns the headings show, plus their total.
      rows.push([]);
      rows.push([`Summary by ${dd.groupNoun ?? 'month'}`]);
      rows.push(def.columns.map(c => c.label));
      for (const g of groups) rows.push(def.columns.map(c => String(fmtCell(g.row[c.key], c.type))));
      rows.push(def.columns.map((c, i) => {
        if (i === 0) return 'Total';
        if (c.type !== 'aed' && c.type !== 'number' && c.type !== 'delta') return '';
        const n = groups.reduce((s, g) => s + (Number(g.row[c.key]) || 0), 0);
        return c.type === 'number' ? String(n) : (n / 100).toFixed(2);
      }));

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
            <InfoTip text={def.description} note={def.dataNoteInInfo ? def.dataNote : undefined} />
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

      {/* Data-quality caution banner — unless the report folds it behind the ⓘ. */}
      {def.dataNote && !def.dataNoteInInfo && (
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
                {(dataYears ? [...dataYears].reverse() : REPORT_YEARS).map(y => <option key={y} value={y}>{y}</option>)}
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
                {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
          {def.controlKey === 'leaseExpiryWindow' && (
            <div className={fGroup}>
              <span className={fLabel}>Window</span>
              <select className={fSelect} value={leaseWindow}
                onChange={e => { const w = Number(e.target.value); setLeaseWindow(w); if (urlBase) router.replace(`${urlBase}/lease-expiry?window=${w}`); }}
                aria-label="Window">
                {/* The window runs to the end of the month it lands in, so every
                    month in view is complete. Naming that month makes the option
                    self-explanatory — "90 days" alone gave no hint that November
                    was included whole. */}
                {[30, 60, 90, 180, 365].map(w => (
                  <option key={w} value={w}>{`${w} days · to ${monthEndLabel(w)}`}</option>
                ))}
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
              <select className={fSelect} aria-label="Lease status" value={leaseStatus} onChange={e => setLeaseStatus(e.target.value as 'active' | 'expired' | 'terminated' | 'all')}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>
          )}
          {def.contractStatusFilters && (
            <>
              <div className={fGroup}>
                <span className={fLabel}>Month</span>
                <select className={fSelect} aria-label="Month" value={csMonth} onChange={e => setCsMonth(e.target.value)}>
                  <option value="all">All months</option>
                  {['January', 'February', 'March', 'April', 'May', 'June', 'July',
                    'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                    <option key={m} value={String(i + 1)}>{m}</option>
                  ))}
                </select>
              </div>
              <div className={fGroup}>
                <span className={fLabel}>Status</span>
                <select className={fSelect} aria-label="Status" value={csStatus} onChange={e => setCsStatus(e.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="renewed">Renewed</option>
                  <option value="for_signature">For signature</option>
                  <option value="pending">Pending</option>
                  <option value="move_out">Move-out</option>
                </select>
              </div>
              <div className={fGroup}>
                <span className={fLabel}>Stage</span>
                <select className={fSelect} aria-label="Stage" value={csStage} onChange={e => setCsStage(e.target.value)}>
                  <option value="all">All stages</option>
                  <option value="not_started">Not started</option>
                  <option value="draft">Draft</option>
                  <option value="notice_sent">Notice sent</option>
                  <option value="kyc">KYC</option>
                  <option value="payment_plan">Payment plan</option>
                  <option value="cheques">Cheques / PDC</option>
                  <option value="customer_signature">Customer signature</option>
                  <option value="landlord_signature">Landlord signature</option>
                  <option value="both_signatures">Both signatures</option>
                  <option value="registration">Contract Registration</option>
                  <option value="utility">Utility account</option>
                  <option value="move_in">Move-in</option>
                  <option value="ready_to_activate">Ready to activate</option>
                  <option value="completed">Completed</option>
                  <option value="termination">Termination acceptance</option>
                  <option value="move_out_inspection">Move-out inspection</option>
                  <option value="bill_clearance">Bills cleared</option>
                  <option value="settlement">Deposit settlement</option>
                </select>
              </div>
              <div className={fGroup}>
                <span className={fLabel}>Signed by</span>
                <select className={fSelect} aria-label="Signed by" value={csSignature} onChange={e => setCsSignature(e.target.value)}>
                  <option value="all">Anyone</option>
                  <option value="both">Customer &amp; landlord</option>
                  <option value="customer_only">Customer only</option>
                  <option value="landlord_only">Landlord only</option>
                  <option value="none">Neither</option>
                </select>
              </div>
              <div className={fGroup}>
                <span className={fLabel}>Cheques</span>
                <select className={fSelect} aria-label="Cheques" value={csCheques} onChange={e => setCsCheques(e.target.value)}>
                  <option value="all">All</option>
                  <option value="on_file">On file</option>
                  <option value="missing">Not recorded</option>
                </select>
              </div>
              <div className={fGroup}>
                <span className={fLabel}>Registration</span>
                <select className={fSelect} aria-label="Registration" value={csRegistration} onChange={e => setCsRegistration(e.target.value)}>
                  <option value="all">All</option>
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                  <option value="not_applicable">Not applicable</option>
                </select>
              </div>
            </>
          )}
          {def.occupancyFilter && (
            <div className={fGroup}>
              <span className={fLabel}>Occupancy</span>
              <select className={fSelect} aria-label="Occupancy" value={occupancy} onChange={e => setOccupancy(e.target.value as 'all' | 'occupied' | 'vacant')}>
                <option value="occupied">Occupied</option>
                <option value="vacant">Vacant</option>
                <option value="all">All</option>
              </select>
            </div>
          )}
          {def.contractStatusFilters && (
            <>
              <div className={fGroup}>
                <span className={fLabel}>Month</span>
                <select className={fSelect} aria-label="Month" value={csMonth} onChange={e => setCsMonth(e.target.value)}>
                  <option value="all">All months</option>
                  {['January', 'February', 'March', 'April', 'May', 'June', 'July',
                    'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                    <option key={m} value={String(i + 1)}>{m}</option>
                  ))}
                </select>
              </div>
              {/* Status / Stage / Signed by / Cheques / Registration were removed
                  from this sheet (3 Aug) — the landlord filters it by Year, Lease
                  type, Property and Month. The backend still accepts every one of
                  those query params, so a saved link or a future control keeps
                  working; only the UI is gone. */}
            </>
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

      {/* VAT scope — exempt residential leases are hidden by default so what is
          left is what a return is actually built from. */}
      {def.feeTaxationControls && (
        <div className={ctrlRowCls}>
          <span className={ctrlLabelCls}>Leases:</span>
          {([
            { id: 'applicable', label: 'VAT-applicable only' },
            { id: 'all',        label: 'Incl. exempt' },
          ] as const).map(v => (
            <button key={v.id} onClick={() => setVatScope(v.id)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${vatScope === v.id ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
              {v.label}
            </button>
          ))}
          <span className="text-[11px] text-[#9b9890] ml-1">
            {vatScope === 'applicable'
              ? 'Only leases that can carry output VAT — exempt residential rent is hidden.'
              : 'Every lease, including exempt residential rent that adds nothing to a return.'}
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
            {REPORT_YEARS.map(y => (
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
          {(dataYears ?? [...REPORT_YEARS].reverse()).map(y => (
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
                    <span className={`text-sm font-bold whitespace-nowrap ${isOverdue ? 'text-[#b91c1c]' : 'text-[#1a1916]'}`}>{String(g.row[dd.titleKey] ?? '')}</span>
                  </div>
                  {/* Wraps rather than overflowing — a report with many summary
                      figures would otherwise push the last ones off the edge. */}
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 min-w-0">
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
                        {g.items.map((it, idx) => {
                          // Lease-level columns show once per block. `sameBlock`
                          // is derived from the rendered array, so filtering the
                          // list re-computes which row starts a block.
                          const prev = idx > 0 ? g.items[idx - 1] : null;
                          const sameBlock = !!dd.mergeKeys?.length && !!dd.contractIdKey && !!prev
                            && prev[dd.contractIdKey] === it[dd.contractIdKey];
                          const merged = new Set(dd.mergeKeys ?? []);
                          // Sub-heading whenever the grouped-by value changes.
                          const subHead = dd.groupByKey && (!prev || prev[dd.groupByKey] !== it[dd.groupByKey])
                            ? String(it[dd.groupByKey] ?? '—')
                            : null;
                          const span = dd.columns.length + (dd.contractIdKey ? 1 : 0);
                          return (
                          <Fragment key={`b${idx}`}>
                          {subHead && (
                            <tr className="border-t border-[#e3e0d9] bg-[#faf9f6]">
                              <td colSpan={span} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6b6860]">
                                {subHead}
                              </td>
                            </tr>
                          )}
                          <tr className={`hover:bg-[#fafaf8] ${sameBlock ? 'border-t border-[#f7f5f1]' : 'border-t border-[#e3e0d9]'}`}>
                            {dd.columns.map(c => (
                              <td key={c.key} className={`px-3 ${sameBlock ? 'py-1.5' : 'py-2'} ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>
                                {sameBlock && merged.has(c.key) ? null : <CellValue value={it[c.key]} type={c.type} />}
                              </td>
                            ))}
                            {dd.contractIdKey && (
                              <td className="px-3 py-2.5 text-right print:hidden">
                                {it[dd.contractIdKey] != null && (() => {
                                  // While the record is still on the Operations
                                  // worklist, that is where the work happens.
                                  const inOps = !!(dd.opsLinkKey && it[dd.opsLinkKey]);
                                  return (
                                    <Link
                                      href={inOps
                                        ? `${contractsBase.replace(/\/contracts$/, '/operations')}/${it[dd.contractIdKey]}`
                                        : `${contractsBase}/${it[dd.contractIdKey]}/v2`}
                                      className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline"
                                      title={inOps ? 'Open in Operations' : 'Open contract'}>
                                      {inOps ? 'Operations' : 'Open'} <ExternalLink size={12} />
                                    </Link>
                                  );
                                })()}
                              </td>
                            )}
                          </tr>
                          </Fragment>
                          );
                        })}
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
          {/* The table scrolls inside its own box, BOTH ways. A wrapper with only
              overflow-x is its own scroll container, so a sticky header pins to
              something that never moves vertically — the labels scrolled away and
              29 unheaded month columns are unreadable. Capping the height here
              gives the sticky header a container that actually scrolls. */}
          <div className="overflow-auto max-h-[72vh] print:max-h-none print:overflow-visible">
            <table className="text-xs border-collapse min-w-full">
              {/* Header stays put while the sheet scrolls — 29 columns of months and
                  totals are unreadable once the labels have gone off the top. */}
              <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890] sticky top-0 z-20 print:static">
                <tr>
                  <th className="sticky left-0 z-30 bg-[#fafaf8] px-4 py-3 text-left font-semibold min-w-[190px]">By Unit</th>
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0] bg-[#fafaf8]">Annual rent</th>
                  {(data?.months ?? []).map(m => (
                    <th key={m} className="px-3 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0] bg-[#fafaf8]">{m}</th>
                  ))}
                  {/* Trailing columns: a report may declare its own set (Rent Receivable
                      needs Total / Cleared / Pending / Bounced, not the YTD pair). */}
                  {def.matrixTrailing ? def.matrixTrailing.map((c, ci) => (
                    <th key={c.key} className={`px-4 py-3 text-right font-semibold whitespace-nowrap bg-[#fafaf8] ${ci < (def.matrixTrailing!.length - 1) ? 'border-l border-[#e8e6e0]' : ''}`}>{c.label}</th>
                  )) : (<>
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">Total</th>
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">YTD Expected</th>
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">YTD Received</th>
                  </>)}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // With matrixGroupKey the body reads like the printed sheet: a
                  // property bar, its units, then that property's own line. Without
                  // it nothing changes — the rows render flat as before.
                  if (!def.matrixGroupKey) return null;
                  const key = def.matrixGroupKey;
                  const seen: string[] = [];
                  const groups = new Map<string, Record<string, unknown>[]>();
                  for (const r of sorted) {
                    const g = String(r[key] ?? '—');
                    if (!groups.has(g)) { groups.set(g, []); seen.push(g); }
                    groups.get(g)!.push(r);
                  }
                  const monthCount = (data?.months ?? []).length;
                  const trailing = def.matrixTrailing ?? [];
                  return seen.map(g => {
                    const rows = groups.get(g)!;
                    const cols = new Array(monthCount).fill(0);
                    for (const r of rows) ((r.cells as { amountFils: number }[]) ?? []).forEach((c, ci) => { cols[ci] += Number(c.amountFils) || 0; });
                    const rent = rows.reduce((a, r) => a + (Number(r.annualRentFils) || 0), 0);
                    return (
                      <Fragment key={g}>
                        <tr className="bg-[#f0ede8] border-t border-[#e8e6e0]">
                          <td className="sticky left-0 z-10 bg-[#f0ede8] px-4 py-2 text-left text-[12px] font-bold text-[#1a1916] whitespace-nowrap">
                            {g} <span className="font-normal text-[#9b9890]">{rows.length} unit{rows.length === 1 ? '' : 's'}</span>
                          </td>
                          <td colSpan={1 + monthCount + Math.max(trailing.length, 3)} className="bg-[#f0ede8]" />
                        </tr>
                        {rows.map((row, i) => renderMatrixRow(row, `${g}-${i}`))}
                        <tr className="bg-[#fafaf8] border-t border-[#e8e6e0] font-semibold text-[#1a1916]">
                          <td className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-2 text-left text-[11px] whitespace-nowrap">{g} subtotal</td>
                          <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap border-l border-[#e8e6e0]">{fmtAmt(rent)}</td>
                          {cols.map((t, ti) => (
                            <td key={ti} className="px-3 py-2 text-right tabular-nums whitespace-nowrap border-l border-[#e8e6e0]">{fmtAmt(t)}</td>
                          ))}
                          {trailing.map((c, ci) => (
                            <td key={c.key} className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${ci < trailing.length - 1 ? 'border-l border-[#e8e6e0]' : ''}`}>
                              {fmtAmt(rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0))}
                            </td>
                          ))}
                        </tr>
                      </Fragment>
                    );
                  });
                })()}
                {!def.matrixGroupKey && sorted.map((row, i) => renderMatrixRow(row, String(i)))}
              </tbody>
              <tfoot className="bg-[#fafaf8] border-t-2 border-[#e8e6e0] font-bold text-[#1a1916]">
                <tr>
                  <td className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-3 text-left">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap border-l border-[#e8e6e0]">{fmtAmt(matrixView?.totals?.annualRentFils ?? data?.totals?.annualRentFils)}</td>
                  {(matrixView?.columnTotals ?? data?.columnTotals ?? []).map((t, ti) => (
                    <td key={ti} className="px-3 py-3 text-right tabular-nums whitespace-nowrap border-l border-[#e8e6e0]">{fmtAmt(t)}</td>
                  ))}
                  {def.matrixTrailing ? def.matrixTrailing.map((c, ci) => (
                    <td key={c.key} className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${ci < (def.matrixTrailing!.length - 1) ? 'border-l border-[#e8e6e0]' : ''}`}>
                      {c.type === 'number'
                        ? fmtNumber(Number(matrixView?.totals?.[c.key] ?? data?.totals?.[c.key]))
                        : fmtAmt(matrixView?.totals?.[c.key] ?? data?.totals?.[c.key])}
                    </td>
                  )) : (<>
                  <td className="px-4 py-3 text-right tabular-nums border-l border-[#e8e6e0]">{fmtAmt(matrixView?.totals?.scheduledFils ?? data?.totals?.scheduledFils)}</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap border-l border-[#e8e6e0]">{fmtAmt(matrixView?.totals?.ytdExpectedFils ?? data?.totals?.ytdExpectedFils)}</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-[#15803d]">{fmtAmt(matrixView?.totals?.ytdReceivedFils ?? data?.totals?.ytdReceivedFils)}</td>
                  </>)}
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
                      {(def.matrixTrailing ? def.matrixTrailing.slice(1) : [{ key: 'a' }, { key: 'b' }]).map((c, ci) => (
                        <td key={ci} className={`px-3 py-2 ${ci === 0 ? 'border-l border-[#e8e6e0]' : ''}`} />
                      ))}
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
          {def.summaryPanels && (
            <div className="border-t border-[#e8e6e0] grid gap-5 px-5 py-5 md:grid-cols-2 xl:grid-cols-3 bg-[#fdfcfa] print:break-inside-avoid">
              {def.summaryPanels.map(panel => (
                <div key={panel.title}>
                  <div className="text-[12px] font-bold text-[#1a1916] mb-2">{panel.title}</div>
                  <table className="w-full text-[12px] border border-[#e8e6e0] rounded-lg overflow-hidden">
                    <tbody>
                      {panel.rows.map(r => {
                        // Whichever view is driving this layout — the cheque grid has no matrixView,
                        // and the derived reconciliation figures live on the view, not on data.
                        const view = matrixView ?? chequeView;
                        const v = r.key ? (view?.totals?.[r.key] ?? data?.totals?.[r.key]) : undefined;
                        return (
                          <tr key={r.label} className={`border-b border-[#f0ede8] last:border-b-0 ${r.total ? 'bg-[#f4f3ef] font-bold text-[#1a1916]' : 'text-[#6b6860]'}`}>
                            <td className="px-3 py-2 text-left">
                              {r.label}
                              {r.note && <span className="block text-[10.5px] text-[#9b9890] font-normal">{r.note}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-[#1a1916]">{fmtAmt(v)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {panel.note && <p className="text-[11px] text-[#6b6860] mt-2 leading-relaxed">{panel.note}</p>}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 px-3 py-2 border-t border-[#f0ede8] text-[11px] text-[#6b6860]">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#15803d]" /> Collected</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#b45309]" /> Pending</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#dc2626]" /> Bounced</span>
            <span className="flex items-center gap-1.5"><span className="text-[#d4d2cc]">·</span> No cheque due</span>
          </div>
        </div>
      ) : def.layout === 'chequeMatrix' ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:border-none print:rounded-none">
          {/* Scrolls both ways with a pinned header — same reason as the matrix:
              22 month columns are unreadable once the labels leave the top. */}
          <div className="overflow-auto max-h-[72vh] print:max-h-none print:overflow-visible">
            <table className="text-xs border-collapse min-w-full">
              <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890] sticky top-0 z-20 print:static">
                <tr>
                  <th className="sticky left-0 z-30 bg-[#fafaf8] px-4 py-3 text-left font-semibold min-w-[130px]">Unit</th>
                  <th className="px-3 py-3 text-left font-semibold whitespace-nowrap bg-[#fafaf8]">Customer</th>
                  {Array.from({ length: data?.maxCheques ?? 0 }, (_, i) => (
                    <th key={i} className={`px-3 py-3 text-right font-semibold whitespace-nowrap ${i === 0 ? 'border-l border-[#e8e6e0]' : ''}`}>Cheque {i + 1}</th>
                  ))}
                  {/* The label is the month itself. A "Month N" counter made sense
                      when the grid was a fixed twelve; the columns now run the length
                      of the book, so it read "Month 22" and meant nothing. */}
                  {(data?.months ?? []).map(m => (
                    <th key={m} className="px-3 py-3 text-center font-semibold whitespace-nowrap border-l border-[#f0ede8] bg-[#fafaf8]">{m}</th>
                  ))}
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">Total cheques</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Grouped by property: a bar, its units, then that property's line.
                  if (!def.matrixGroupKey) return null;
                  const key = def.matrixGroupKey;
                  const order: string[] = [];
                  const groups = new Map<string, Record<string, unknown>[]>();
                  for (const r of sorted) {
                    const g = String(r[key] ?? '—');
                    if (!groups.has(g)) { groups.set(g, []); order.push(g); }
                    groups.get(g)!.push(r);
                  }
                  const nMonths = (data?.months ?? []).length;
                  const nChq = data?.maxCheques ?? 0;
                  return order.map(g => {
                    const rows = groups.get(g)!;
                    const cols = new Array(nMonths).fill(0);
                    for (const r of rows) ((r.monthCounts as number[]) ?? []).forEach((n, ci) => { cols[ci] += Number(n) || 0; });
                    const tot = rows.reduce((a, r) => a + (Number(r.totalCheques) || 0), 0);
                    return (
                      <Fragment key={g}>
                        <tr className="bg-[#f0ede8] border-t border-[#e8e6e0]">
                          <td className="sticky left-0 z-10 bg-[#f0ede8] px-4 py-2 text-left text-[12px] font-bold text-[#1a1916] whitespace-nowrap">
                            {g} <span className="font-normal text-[#9b9890]">{rows.length} unit{rows.length === 1 ? '' : 's'}</span>
                          </td>
                          <td colSpan={1 + nChq + nMonths + 1} className="bg-[#f0ede8]" />
                        </tr>
                        {rows.map((row, i) => renderChequeRow(row, `${g}-${i}`))}
                        <tr className="bg-[#fafaf8] border-t border-[#e8e6e0] font-semibold text-[#1a1916]">
                          <td className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-2 text-left text-[11px] whitespace-nowrap">{g} subtotal</td>
                          <td className="px-3 py-2" colSpan={1 + nChq} />
                          {cols.map((n, ci) => (
                            <td key={ci} className="px-3 py-2 text-center tabular-nums whitespace-nowrap border-l border-[#f0ede8]">{n ? fmtNumber(n) : '·'}</td>
                          ))}
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap border-l border-[#f0ede8]">{fmtNumber(tot)}</td>
                        </tr>
                      </Fragment>
                    );
                  });
                })()}
                {!def.matrixGroupKey && sorted.map((row, i) => renderChequeRow(row, String(i)))}
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
          {def.summaryPanels && (
            <div className="border-t border-[#e8e6e0] grid gap-5 px-5 py-5 md:grid-cols-2 xl:grid-cols-3 bg-[#fdfcfa] print:break-inside-avoid">
              {def.summaryPanels.map(panel => (
                <div key={panel.title}>
                  <div className="text-[12px] font-bold text-[#1a1916] mb-2">{panel.title}</div>
                  <table className="w-full text-[12px] border border-[#e8e6e0] rounded-lg overflow-hidden">
                    <tbody>
                      {panel.rows.map(r => {
                        // Whichever view is driving this layout — the cheque grid has no matrixView,
                        // and the derived reconciliation figures live on the view, not on data.
                        const view = matrixView ?? chequeView;
                        const v = r.key ? (view?.totals?.[r.key] ?? data?.totals?.[r.key]) : undefined;
                        return (
                          <tr key={r.label} className={`border-b border-[#f0ede8] last:border-b-0 ${r.total ? 'bg-[#f4f3ef] font-bold text-[#1a1916]' : 'text-[#6b6860]'}`}>
                            <td className="px-3 py-2 text-left">
                              {r.label}
                              {r.note && <span className="block text-[10.5px] text-[#9b9890] font-normal">{r.note}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-[#1a1916]">{fmtAmt(v)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {panel.note && <p className="text-[11px] text-[#6b6860] mt-2 leading-relaxed">{panel.note}</p>}
                </div>
              ))}
            </div>
          )}
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
              Months add up to Renewals — the units coming up for renewal in the selected year (each counted once, in its renewal month). Vacant and Total units are current inventory (each unit&rsquo;s live status), independent of the year, so Renewals + Vacant is normally less than Total units: the difference is the occupied units whose renewal falls outside this year — already overdue, or not due until next year. Click a Vacant count to list those units.
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
            ? (() => {
                const noun = def.drilldown?.groupNoun ?? 'month';
                return `${groups.reduce((n, g) => n + g.items.length, 0)} ${def.drilldown?.countLabel ?? 'rows'} across ${groups.length} ${noun}${groups.length === 1 ? '' : 's'}`;
              })()
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
                  {cellModal.items.map((it, idx) => {
                    // A cheque that bounced carries its whole story — presented,
                    // returned, penalty, each replacement, where it ended up.
                    // Expanded by default: someone clicking a bounce is asking
                    // exactly this, and one more click to find out is one too many.
                    const history = (it.history as ChequeEvent[] | null) ?? null;
                    const span = cellModal.columns.length + (cellModal.contractIdKey ? 1 : 0);
                    return (
                    <Fragment key={idx}>
                    <tr className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
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
                    {history && history.length > 0 && (
                      <tr className="border-t border-[#f0ede8]">
                        <td colSpan={span} className="px-3 pb-3 pt-1 bg-[#fdfcfa]">
                          <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold mb-1.5">
                            What happened to this cheque
                          </div>
                          <ol className="border-l-2 border-[#e8e6e0] ml-1">
                            {history.map((h, hi) => (
                              <li key={hi} className="relative pl-4 pb-2 last:pb-0">
                                <span className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${
                                  h.status === 'bounced' ? 'bg-[#dc2626]'
                                  : h.status === 'cleared' ? 'bg-[#15803d]'
                                  : h.status === 'pending' ? 'bg-[#b45309]' : 'bg-[#c8c6c0]'}`} />
                                <div className="flex items-baseline justify-between gap-3">
                                  <div className="min-w-0">
                                    <span className="text-[12px] font-semibold text-[#1a1916]">{h.event}</span>
                                    {h.detail && <span className="text-[11px] text-[#6b6860] ml-2">{h.detail}</span>}
                                  </div>
                                  <div className="flex items-baseline gap-3 whitespace-nowrap">
                                    <span className="text-[11px] text-[#9b9890]">{h.date ? fmtDate(h.date) : ''}</span>
                                    <span className="text-[12px] tabular-nums font-medium text-[#1a1916]">{fmtAmt(h.amountFils)}</span>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
