/**
 * Shared report detail view — interactive table with sort/filter, CSV download
 * and print-friendly PDF, for EVERY report slug. Used by BOTH portals:
 *   RP:      /rental-provider/dashboard/reports/[slug]   (endpointBase /api/reports)
 *   Manager: /dashboard/manager/reports?rp=N&slug=x      (endpointBase /api/manager/reports, extraQuery rp=N)
 * One component so the two portals can never drift again.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Search, Download, Printer, Loader2, FileSpreadsheet,
  BarChart2, AlertCircle, TrendingUp, TrendingDown, Minus, ChevronRight, X, ExternalLink,
} from 'lucide-react';

type ReportSlug = 'occupancy' | 'receivables' | 'lease-expiry' | 'renewal-pipeline' | 'renewal-forecast' | 'leases-by-month' | 'security-deposits' | 'cheque-register' | 'collection-rate' | 'tenant-ledger' | 'portfolio-overview' | 'vacancy-analysis' | 'leasing-activity' | 'rent-collection' | 'fee-taxation' | 'cashflow-forecast' | 'rent-vs-market';

interface DrilldownSpec {
  /** Row field holding the array of child items. */
  childKey: string;
  /** Row field used for the modal title (e.g. the month label). */
  titleKey: string;
  /** Plural noun for the count, e.g. "leases". */
  countLabel: string;
  columns: Column[];
  /** Item field whose value is a contract id → row links to the contract. */
  contractIdKey?: string;
}

interface ReportDef {
  title: string;
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
  layout?: 'table' | 'grouped' | 'matrix';
  /** Optional caution banner shown above the report (e.g. data-quality notes). */
  dataNote?: string;
}

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  type?: 'aed' | 'date' | 'number' | 'bucket' | 'stage' | 'rate' | 'delta';
  width?: string;
}

interface TotalSpec {
  key: string;
  label: string;
  type?: 'aed' | 'number' | 'rate';
  /** Show this tile even when zero — for totals whose 0 IS the signal (e.g. arrears). */
  keep?: boolean;
}

const RENEWAL_FORECAST_DEF: ReportDef = {
  title: 'Renewal Forecast',
  description: 'Leases coming up for renewal each month — count, annual rent at stake, and how many are already in progress. Lapsed leases on occupied units show as Overdue. An unsigned draft renewal does not replace the current lease — it marks that lease\'s renewal as in progress (Proposed).',
  endpoint: '/api/reports/renewal-forecast',
  layout: 'grouped',
  controlKey: 'forecastMonths',
  columns: [
    { key: 'monthLabel', label: 'Month' },
    { key: 'leases', label: 'Leases up for renewal', align: 'right', type: 'number' },
    { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
    { key: 'inProgress', label: 'In progress', align: 'right', type: 'number' },
    { key: 'notStarted', label: 'Not started', align: 'right', type: 'number' },
  ],
  totals: [
    { key: 'overdue', label: 'Overdue', type: 'number' },
    { key: 'next90', label: 'Next 90 days', type: 'number' },
    { key: 'next12mo', label: 'Next 12 months', type: 'number' },
    { key: 'totalLeases', label: 'Total leases', type: 'number' },
    { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
    { key: 'notStarted', label: 'Not started', type: 'number' },
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
  occupancy: {
    title: 'Occupancy Report',
    description: 'Snapshot of how each property is performing — units, occupied counts, and the rent roll. "Rent Roll" is the latest lease on every occupied unit (so it reconciles with occupancy, including units on lapsed leases pending renewal); "Active leases" counts only contracts still in active status.',
    endpoint: '/api/reports/occupancy',
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'community', label: 'Community' },
      { key: 'emirate', label: 'Emirate' },
      { key: 'totalUnits', label: 'Units', align: 'right', type: 'number' },
      { key: 'occupiedUnits', label: 'Occupied', align: 'right', type: 'number' },
      { key: 'vacantUnits', label: 'Vacant', align: 'right', type: 'number' },
      { key: 'maintenanceUnits', label: 'Maintenance', align: 'right', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', align: 'right', type: 'rate' },
      { key: 'rentRollFils', label: 'Rent Roll', align: 'right', type: 'aed' },
      { key: 'activeContractedRentFils', label: 'Active leases', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'properties', label: 'Properties', type: 'number' },
      { key: 'units', label: 'Units', type: 'number' },
      { key: 'occupied', label: 'Occupied', type: 'number' },
      { key: 'vacant', label: 'Vacant', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', type: 'rate' },
      { key: 'rentRollFils', label: 'Rent Roll', type: 'aed' },
      { key: 'activeContractedRentFils', label: 'On active leases', type: 'aed' },
    ],
  },
  receivables: {
    title: 'Receivables Summary',
    description: 'Outstanding rent and admin-fee cheques, aged into buckets so you see what is overdue and by how long.',
    endpoint: '/api/reports/receivables',
    dataNote: NEEDS_CHEQUE_DATA,
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'description', label: 'Description' },
      { key: 'chequeNumber', label: 'Cheque #' },
      { key: 'dueDate', label: 'Due', type: 'date' },
      { key: 'ageDays', label: 'Age (days)', align: 'right', type: 'number' },
      { key: 'bucket', label: 'Bucket', type: 'bucket' },
      { key: 'amountFils', label: 'Amount', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'overdueFils', label: 'Overdue (arrears)', type: 'aed', keep: true },
      { key: 'upcomingFils', label: 'Upcoming PDCs', type: 'aed' },
      { key: 'currentFils', label: 'Due today', type: 'aed' },
      { key: 'overdue30Fils', label: 'Overdue 1-30', type: 'aed' },
      { key: 'overdue60Fils', label: 'Overdue 31-60', type: 'aed' },
      { key: 'overdue90Fils', label: 'Overdue 61-90', type: 'aed' },
      { key: 'overdue90PlusFils', label: 'Overdue 90+', type: 'aed' },
      { key: 'totalOutstandingFils', label: 'Total (incl. upcoming)', type: 'aed' },
    ],
  },
  'lease-expiry': {
    title: 'Lease Expiry Report',
    description: 'Active contracts whose end date is approaching, with their current renewal state.',
    endpoint: '/api/reports/lease-expiry',
    controlKey: 'leaseExpiryWindow',
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'startDate', label: 'Start', type: 'date' },
      { key: 'endDate', label: 'End', type: 'date' },
      { key: 'daysUntilExpiry', label: 'Days left', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
      { key: 'renewalStatus', label: 'Renewal', type: 'stage' },
    ],
    totals: [
      { key: 'expiring', label: 'Expiring', type: 'number' },
      { key: 'renewedOrAccepted', label: 'Renewed / Accepted', type: 'number' },
      { key: 'awaitingDecision', label: 'Awaiting Decision', type: 'number' },
      { key: 'rejected', label: 'Rejected', type: 'number' },
      { key: 'contractedRentFils', label: 'Contracted Rent', type: 'aed' },
    ],
  },
  // Both slugs resolve to the same forecast (renewal-forecast is canonical;
  // renewal-pipeline kept so older links/bookmarks still work).
  'renewal-forecast': RENEWAL_FORECAST_DEF,
  'renewal-pipeline': RENEWAL_FORECAST_DEF,
  'leases-by-month': {
    title: 'Leases by Month',
    description: 'How many leases started each month — every lease bucketed by its start date, so you can see how many contracts commenced in January, February, and so on. Defaults to this year; use the period control to pick a different year or range. Expand a month to see every lease by customer.',
    endpoint: '/api/reports/leases-by-month',
    layout: 'grouped',
    controlKey: 'dateRange',
    columns: [
      { key: 'monthLabel', label: 'Month' },
      { key: 'contracts', label: 'Leases started', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'contracts', label: 'Leases started', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent', type: 'aed' },
      { key: 'months', label: 'Months', type: 'number' },
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
        { key: 'startDate', label: 'Lease starts', type: 'date' },
        { key: 'endDate', label: 'Lease ends', type: 'date' },
        { key: 'annualRentFils', label: 'Annual rent', align: 'right', type: 'aed' },
        { key: 'status', label: 'Status', type: 'stage' },
      ],
    },
  },
  'security-deposits': {
    title: 'Security Deposits Report',
    description: 'Full deposit register and settlement ledger. A deposit is collected at lease start and refundable at lease end. Status shows where each one stands: Holding (live lease), Pending settlement (lease ended — needs to be refunded or deducted), or settled as Returned, Partial return or Forfeited. Refunded / Kept are the amounts that moved at settlement. The tiles up top answer how much you currently hold, how much is pending settlement, and what has been refunded to tenants vs kept. Pick a year to scope the register to deposits taken that year, or All years for the full register.',
    endpoint: '/api/reports/security-deposits',
    controlKey: 'yearRange',
    columns: [
      { key: 'contractRef', label: 'Contract' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'depositFils', label: 'Deposit', align: 'right', type: 'aed' },
      { key: 'reference', label: 'Cheque / Ref' },
      { key: 'state', label: 'Status', type: 'stage' },
      { key: 'refundedFils', label: 'Refunded', align: 'right', type: 'aed' },
      { key: 'deductedFils', label: 'Kept', align: 'right', type: 'aed' },
      { key: 'settledOn', label: 'Settled on', type: 'date' },
      { key: 'takenOn', label: 'Taken on', type: 'date' },
      { key: 'leaseEnd', label: 'Refundable at', type: 'date' },
    ],
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
    title: 'Rent Collection (Rent Roll)',
    description: 'The collection matrix — every customer down the side, the twelve months of the year across the top. Each cell is that month\'s rent cheque, coloured by status (collected / pending / bounced), with a row total per customer and a monthly totals row. Pick the year above.',
    endpoint: '/api/reports/rent-collection',
    dataNote: NEEDS_CHEQUE_DATA,
    layout: 'matrix',
    controlKey: 'year',
    columns: [],
    totals: [
      { key: 'customers', label: 'Customers', type: 'number' },
      { key: 'scheduledFils', label: 'Total rent', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', type: 'aed' },
      { key: 'collectionRate', label: 'Collection rate', type: 'rate' },
    ],
  },

  'cheque-register': {
    title: 'PDC / Cheque Register',
    description: 'Every cheque on file with its lifecycle — pending, cleared, bounced or cancelled. Post-dated cheques are simply those with a future cheque date. The date range filters by cheque date.',
    endpoint: '/api/reports/cheque-register',
    dataNote: NEEDS_CHEQUE_DATA,
    controlKey: 'dateRange',
    columns: [
      { key: 'chequeDate', label: 'Cheque date', type: 'date' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'chequeNumber', label: 'Cheque #' },
      { key: 'paymentType', label: 'Type', type: 'stage' },
      { key: 'amountFils', label: 'Amount', align: 'right', type: 'aed' },
      { key: 'status', label: 'Status', type: 'stage' },
    ],
    totals: [
      { key: 'cheques', label: 'Cheques', type: 'number' },
      { key: 'clearedFils', label: 'Cleared', type: 'aed' },
      { key: 'pendingFils', label: 'Pending', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', type: 'aed' },
      { key: 'cancelledFils', label: 'Cancelled', type: 'aed' },
      { key: 'totalFils', label: 'Total', type: 'aed' },
    ],
  },

  'collection-rate': {
    title: 'Collection Rate Report',
    description: 'Monthly rent collection performance — cheques due each month, how much cleared (collected), what is still pending, what bounced, and the collection rate. Anchored on the cheque date; use the date range to scope the period.',
    endpoint: '/api/reports/collection-rate',
    dataNote: NEEDS_CHEQUE_DATA,
    controlKey: 'dateRange',
    columns: [
      { key: 'label', label: 'Month' },
      { key: 'scheduled', label: 'Cheques due', align: 'right', type: 'number' },
      { key: 'scheduledFils', label: 'Scheduled', align: 'right', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', align: 'right', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', align: 'right', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', align: 'right', type: 'aed' },
      { key: 'collectionRate', label: 'Collection %', align: 'right', type: 'rate' },
    ],
    totals: [
      { key: 'scheduled', label: 'Cheques due', type: 'number' },
      { key: 'scheduledFils', label: 'Scheduled', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', type: 'aed' },
      { key: 'collectionRate', label: 'Collection rate', type: 'rate' },
    ],
  },

  'tenant-ledger': {
    title: 'Customer Ledger',
    description: 'Per-customer rent cashflow — what was scheduled, collected, is still outstanding and bounced, with each customer\'s collection rate and last payment. Sorted by who owes the most. Use the date range to scope the period.',
    endpoint: '/api/reports/tenant-ledger',
    dataNote: NEEDS_CHEQUE_DATA,
    controlKey: 'dateRange',
    columns: [
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'buildingName', label: 'Property' },
      { key: 'cheques', label: 'Cheques', align: 'right', type: 'number' },
      { key: 'scheduledFils', label: 'Scheduled', align: 'right', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', align: 'right', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', align: 'right', type: 'aed' },
      { key: 'collectionRate', label: 'Collection %', align: 'right', type: 'rate' },
      { key: 'lastPaymentDate', label: 'Last payment', type: 'date' },
    ],
    totals: [
      { key: 'customers', label: 'Customers', type: 'number' },
      { key: 'scheduledFils', label: 'Scheduled', type: 'aed' },
      { key: 'collectedFils', label: 'Collected', type: 'aed' },
      { key: 'outstandingFils', label: 'Outstanding', type: 'aed' },
      { key: 'bouncedFils', label: 'Bounced', type: 'aed' },
      { key: 'collectionRate', label: 'Collection rate', type: 'rate' },
    ],
  },

  'portfolio-overview': {
    title: 'Portfolio Overview',
    description: 'Portfolio composition by unit type — how many units of each type, how many are occupied, and the annual asking rent they represent, split by residential / commercial. A current snapshot of what you own and what it\'s worth.',
    endpoint: '/api/reports/portfolio-overview',
    columns: [
      { key: 'spaceCategory', label: 'Category', type: 'stage' },
      { key: 'unitType', label: 'Unit type', type: 'stage' },
      { key: 'units', label: 'Units', align: 'right', type: 'number' },
      { key: 'occupied', label: 'Occupied', align: 'right', type: 'number' },
      { key: 'vacant', label: 'Vacant', align: 'right', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', align: 'right', type: 'rate' },
      { key: 'askingRentFils', label: 'Annual asking rent', align: 'right', type: 'aed' },
      { key: 'avgAskingFils', label: 'Avg / unit', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'properties', label: 'Properties', type: 'number' },
      { key: 'units', label: 'Units', type: 'number' },
      { key: 'occupied', label: 'Occupied', type: 'number' },
      { key: 'vacant', label: 'Vacant', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', type: 'rate' },
      { key: 'askingRentFils', label: 'Annual asking rent', type: 'aed' },
    ],
  },

  'vacancy-analysis': {
    title: 'Vacancy Analysis',
    description: 'Vacant units to action — each available unit with its annual asking rent (revenue at stake) and listing status, plus overall portfolio occupancy. A current snapshot; time-on-market is not tracked yet.',
    endpoint: '/api/reports/vacancy-analysis',
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'unitType', label: 'Type', type: 'stage' },
      { key: 'bedrooms', label: 'Beds', align: 'right', type: 'number' },
      { key: 'listingStatus', label: 'Listing', type: 'stage' },
      { key: 'askingRentFils', label: 'Asking rent / yr', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'vacant', label: 'Vacant units', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy', type: 'rate' },
      { key: 'listed', label: 'Listed', type: 'number' },
      { key: 'unlisted', label: 'Unlisted', type: 'number' },
      { key: 'vacantAskingFils', label: 'Rent at stake / yr', type: 'aed' },
    ],
  },

  'leasing-activity': {
    title: 'Leasing Activity',
    description: 'Monthly leasing velocity — new leases commencing each month, the annual rent they represent, and Ejari registration status. Anchored on the lease start date. Note: historical renewals were imported without a renewal link, so they appear here as new leases.',
    endpoint: '/api/reports/leasing-activity',
    controlKey: 'dateRange',
    columns: [
      { key: 'label', label: 'Month' },
      { key: 'newLeases', label: 'New leases', align: 'right', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent signed', align: 'right', type: 'aed' },
      { key: 'ejariRegistered', label: 'Ejari registered', align: 'right', type: 'number' },
      { key: 'ejariPending', label: 'Ejari pending', align: 'right', type: 'number' },
    ],
    totals: [
      { key: 'newLeases', label: 'New leases', type: 'number' },
      { key: 'annualRentFils', label: 'Annual rent signed', type: 'aed' },
      { key: 'ejariRegistered', label: 'Ejari registered', type: 'number' },
      { key: 'ejariPending', label: 'Ejari pending', type: 'number' },
    ],
  },

  'cashflow-forecast': {
    title: 'Cash Inflow Forecast',
    description: 'When cash actually lands — every post-dated cheque bucketed by the month it falls due. Past-due pending cheques show as Overdue (that is arrears, not future cash); cheques beyond the horizon collapse into Later.',
    endpoint: '/api/reports/cashflow-forecast',
    dataNote: NEEDS_CHEQUE_DATA,
    layout: 'grouped',
    controlKey: 'forecastMonths',
    columns: [
      { key: 'monthLabel', label: 'Month' },
      { key: 'cheques', label: 'Cheques', align: 'right', type: 'number' },
      { key: 'amountFils', label: 'Inflow', align: 'right', type: 'aed' },
    ],
    totals: [
      { key: 'overdueFils', label: 'Overdue (arrears)', type: 'aed', keep: true },
      { key: 'next90Fils', label: 'Next 90 days', type: 'aed' },
      { key: 'horizonFils', label: 'Within horizon', type: 'aed' },
      { key: 'laterFils', label: 'Beyond horizon', type: 'aed' },
      { key: 'totalPendingFils', label: 'Total pending', type: 'aed' },
      { key: 'cheques', label: 'Cheques', type: 'number' },
    ],
    drilldown: {
      childKey: 'items',
      titleKey: 'monthLabel',
      countLabel: 'cheques',
      contractIdKey: 'contractId',
      columns: [
        { key: 'dueDate', label: 'Due', type: 'date' },
        { key: 'tenantName', label: 'Customer' },
        { key: 'unitLabel', label: 'Unit' },
        { key: 'buildingName', label: 'Property' },
        { key: 'chequeNumber', label: 'Cheque #' },
        { key: 'paymentType', label: 'Type', type: 'stage' },
        { key: 'amountFils', label: 'Amount', align: 'right', type: 'aed' },
      ],
    },
  },

  'rent-vs-market': {
    title: 'Rent vs Market',
    description: 'Each occupied unit\'s current rent against its market benchmark — the gap is the rent you can recover when the lease renews. Sorted by biggest uplift first. "At market" is within ±5% of the benchmark.',
    endpoint: '/api/reports/rent-vs-market',
    dataNote: 'The market benchmark is each unit\'s market price as maintained on the Units page — update it there if a benchmark looks stale. Units without a benchmark are listed but excluded from the uplift total.',
    columns: [
      { key: 'buildingName', label: 'Property' },
      { key: 'unitLabel', label: 'Unit' },
      { key: 'tenantName', label: 'Customer' },
      { key: 'unitType', label: 'Type', type: 'stage' },
      { key: 'currentRentFils', label: 'Current rent', align: 'right', type: 'aed' },
      { key: 'marketRentFils', label: 'Market', align: 'right', type: 'aed' },
      { key: 'gapFils', label: 'Gap', align: 'right', type: 'delta' },
      { key: 'gapPct', label: 'Gap %', align: 'right', type: 'rate' },
      { key: 'position', label: 'Position', type: 'stage' },
      { key: 'leaseEnd', label: 'Lease ends', type: 'date' },
    ],
    totals: [
      { key: 'units', label: 'Occupied units', type: 'number' },
      { key: 'belowMarket', label: 'Below market', type: 'number' },
      { key: 'aboveMarket', label: 'Above market', type: 'number' },
      { key: 'currentRentFils', label: 'Current rent (all units)', type: 'aed' },
      { key: 'marketRentFils', label: 'Market (benchmarked units)', type: 'aed' },
      { key: 'upliftFils', label: 'Uplift at renewal', type: 'aed' },
    ],
  },

  'fee-taxation': {
    title: 'Fee & VAT (Taxation)',
    description: 'One-off fees and rent VAT per year, bucketed by the contract start date — net, VAT and the output VAT to file. Admin & commission are VAT-able (5%); ejari is exempt; rent VAT applies to commercial/industrial leases. Use the date range to scope the period.',
    endpoint: '/api/reports/fee-taxation',
    controlKey: 'dateRange',
    dataNote: 'Commission is estimated from your fee rules (annual rent × commission %), since it is not stored per contract — a manually-overridden commission on an individual deal won\'t be reflected. Admin & ejari are the actual net fees on each contract. VAT uses your configured fee rules. Only issued/active/expired/terminated contracts are counted.',
    columns: [
      { key: 'yearLabel', label: 'Year' },
      { key: 'contracts', label: 'Contracts', align: 'right', type: 'number' },
      { key: 'adminNetFils', label: 'Admin (net)', align: 'right', type: 'aed' },
      { key: 'adminVatFils', label: 'Admin VAT', align: 'right', type: 'aed' },
      { key: 'ejariNetFils', label: 'Ejari (net)', align: 'right', type: 'aed' },
      { key: 'ejariVatFils', label: 'Ejari VAT', align: 'right', type: 'aed' },
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
      { key: 'ejariNetFils', label: 'Ejari (net)', type: 'aed' },
      { key: 'ejariVatFils', label: 'Ejari VAT', type: 'aed' },
      { key: 'commissionNetFils', label: 'Commission (net)', type: 'aed' },
      { key: 'commissionVatFils', label: 'Commission VAT', type: 'aed' },
      { key: 'rentNetFils', label: 'Rent (net)', type: 'aed' },
      { key: 'rentVatFils', label: 'Rent VAT', type: 'aed' },
      { key: 'totalVatFils', label: 'Total VAT', type: 'aed' },
    ],
  },
};

// Local-date YYYY-MM-DD (no UTC shift) for the date-range control presets.
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Current calendar year — the default period for every date-range report.
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_START = `${CURRENT_YEAR}-01-01`;
const YEAR_END = `${CURRENT_YEAR}-12-31`;
const RANGE_PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: 'This year',  range: () => ({ from: YEAR_START, to: YEAR_END }) },
  { label: 'This month', range: () => { const n = new Date(); return { from: isoLocal(new Date(n.getFullYear(), n.getMonth(), 1)), to: isoLocal(n) }; } },
  { label: '3 months',   range: () => { const n = new Date(); const f = new Date(n); f.setMonth(f.getMonth() - 3); return { from: isoLocal(f), to: isoLocal(n) }; } },
  { label: '6 months',   range: () => { const n = new Date(); const f = new Date(n); f.setMonth(f.getMonth() - 6); return { from: isoLocal(f), to: isoLocal(n) }; } },
  { label: 'All',        range: () => ({ from: '', to: '' }) },
];

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
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

const BUCKET_STYLE: Record<string, string> = {
  upcoming: 'bg-[#e8f4fd] text-[#1e3a8a]',
  current:  'bg-[#fef3c7] text-[#854d0e]',
  '1-30':   'bg-[#fed7aa] text-[#9a3412]',
  '31-60':  'bg-[#fdba74] text-[#7c2d12]',
  '61-90':  'bg-[#fca5a5] text-[#7f1d1d]',
  '90+':    'bg-[#dc2626] text-white',
};
const STAGE_STYLE: Record<string, string> = {
  not_started: 'bg-[#f4f3ef] text-[#6b6860]',
  proposed:    'bg-[#fef3c7] text-[#854d0e]',
  accepted:    'bg-[#dcfce7] text-[#166534]',
  signed:      'bg-[#dbeafe] text-[#1e40af]',
  active:      'bg-[#d8f2e8] text-[#1a7a5a]',
  rejected:    'bg-[#fee2e2] text-[#b91c1c]',
  // security-deposit lifecycle
  holding:            'bg-[#dbeafe] text-[#1e40af]',  // held against a live lease
  pending_settlement: 'bg-[#fef3c7] text-[#854d0e]',  // lease ended → refund/deduct it
  returned:           'bg-[#dcfce7] text-[#166534]',
  partial_return:     'bg-[#e0e7ff] text-[#3730a3]',
  forfeited:          'bg-[#fee2e2] text-[#b91c1c]',
};

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
  urlBase,
}: ReportDetailViewProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const slug = slugProp as ReportSlug;
  const def = REPORTS[slug];

  const [data, setData] = useState<{ generatedAt: string; totals: Record<string, number>; rows: Record<string, unknown>[]; windowDays?: number; months?: string[]; columnTotals?: number[]; year?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [leaseWindow, setLeaseWindow] = useState<number>(() => Number(sp?.get('window') ?? 90));
  const [forecastMonths, setForecastMonths] = useState<number>(() => Number(sp?.get('months') ?? 12));
  // Default every date-range report to the current calendar year (URL overrides).
  const [from, setFrom] = useState<string>(sp?.get('from') ?? YEAR_START);
  const [to, setTo]     = useState<string>(sp?.get('to') ?? YEAR_END);
  // Matrix (rent-roll) year selector — defaults to the current year.
  const [year, setYear] = useState<number>(() => Number(sp?.get('year')) || CURRENT_YEAR);
  const [drill, setDrill] = useState<Record<string, unknown> | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
    if (extraQuery) url += (url.includes('?') ? '&' : '?') + extraQuery;
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [def, leaseWindow, forecastMonths, from, to, year, endpointBase, extraQuery]);

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return data.rows;
    if (def.layout === 'matrix') {
      return data.rows.filter(row =>
        ['customer', 'unitLabel', 'buildingName', 'contractRef'].some(
          k => String(row[k] ?? '').toLowerCase().includes(needle)));
    }
    return data.rows.filter(row =>
      def.columns.some(c => String(row[c.key] ?? '').toLowerCase().includes(needle)),
    );
  }, [data, search, def]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

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
        return { row, items: matched };
      })
      .filter(g => g.items.length > 0);
  }, [def, data, search]);

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
    if (!data?.rows?.length || def.layout) return dead; // plain table only
    for (const c of def.columns) {
      if (c.type === 'aed' || c.type === 'number') {
        const allZero = data.rows.every(r => { const v = r[c.key]; return v == null || Number(v) === 0; });
        if (allZero) dead.add(c.key);
      }
    }
    return dead;
  }, [data, def]);

  const visibleColumns = useMemo(() => def.columns.filter(c => !deadColKeys.has(c.key)), [def, deadColKeys]);
  const visibleTotals = useMemo(() => def.totals.filter(t => !deadTotalKeys.has(t.key)), [def, deadTotalKeys]);

  function handleCsv() {
    if (!data) return;
    const datestamp = new Date(data.generatedAt).toISOString().slice(0, 10);
    const fmtCell = (raw: unknown, type?: Column['type']) => {
      if (type === 'aed' || type === 'delta') return raw == null ? '' : (Number(raw) / 100).toFixed(2);
      if (type === 'date') return raw ? new Date(String(raw)).toISOString().slice(0, 10) : '';
      return raw ?? '';
    };

    // Matrix layout: customer + unit + property, then a column per month, then total.
    if (def.layout === 'matrix') {
      const months = data.months ?? [];
      const headers = ['Customer', 'Unit', 'Property', ...months, 'Total'];
      const rows = sorted.map(row => {
        const cells = (row.cells as { amountFils: number }[]) ?? [];
        return [
          String(row.customer ?? ''),
          String(row.unitLabel ?? ''),
          String(row.buildingName ?? ''),
          ...cells.map(c => (Number(c.amountFils) / 100).toFixed(2)),
          (Number(row.totalFils) / 100).toFixed(2),
        ];
      });
      rows.push([
        'Total', '', '',
        ...(data.columnTotals ?? []).map(t => (Number(t) / 100).toFixed(2)),
        (Number(data.totals?.scheduledFils ?? 0) / 100).toFixed(2),
      ]);
      downloadCsv(`${slug}-${data.year ?? datestamp}.csv`, headers, rows);
      return;
    }

    // Grouped layout: export one row per child lease, prefixed with its group.
    if (def.layout === 'grouped' && def.drilldown) {
      const dd = def.drilldown;
      const headers = ['Month', ...dd.columns.map(c => c.label)];
      const rows = groups.flatMap(g =>
        g.items.map(it => [String(g.row[dd.titleKey] ?? ''), ...dd.columns.map(c => fmtCell(it[c.key], c.type))]),
      );
      downloadCsv(`${slug}-${datestamp}.csv`, headers, rows);
      return;
    }

    const headers = def.columns.map(c => c.label);
    const rows = sorted.map(row => def.columns.map(c => fmtCell(row[c.key], c.type)));
    downloadCsv(`${slug}-${datestamp}.csv`, headers, rows);
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
          <h1 className="text-2xl font-bold text-[#1a1916]">{def.title}</h1>
          <p className="text-sm text-[#6b6860] mt-0.5 max-w-2xl">{def.description}</p>
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
        <h1 className="text-2xl font-bold">{def.title}</h1>
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

      {/* Lease-expiry window control */}
      {def.controlKey === 'leaseExpiryWindow' && (
        <div className="flex items-center gap-2 mb-4 print:hidden">
          <span className="text-xs text-[#6b6860] font-medium">Window:</span>
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

      {/* Renewal-forecast horizon control */}
      {def.controlKey === 'forecastMonths' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap print:hidden">
          <span className="text-xs text-[#6b6860] font-medium">Horizon:</span>
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

      {/* Date-range control (day / month / 3-6 mo / year / custom) */}
      {def.controlKey === 'dateRange' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap print:hidden">
          <span className="text-xs text-[#6b6860] font-medium">Period:</span>
          {RANGE_PRESETS.map(p => {
            const r = p.range();
            const active = from === r.from && to === r.to;
            return (
              <button key={p.label} onClick={() => { setFrom(r.from); setTo(r.to); }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${active ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
                {p.label}
              </button>
            );
          })}
          <span className="text-xs text-[#9b9890] ml-1">Custom:</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-xs border border-[#e8e6e0] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2e9f82]" />
          <span className="text-xs text-[#9b9890]">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-xs border border-[#e8e6e0] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2e9f82]" />
        </div>
      )}

      {/* Year dropdown (deposit register — "yearly document"): maps the picked
          year to a Jan 1 – Dec 31 from/to range, or clears it for All years. */}
      {def.controlKey === 'yearRange' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap print:hidden">
          <span className="text-xs text-[#6b6860] font-medium">Year:</span>
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

      {/* Year selector (rent-roll matrix) */}
      {def.controlKey === 'year' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap print:hidden">
          <span className="text-xs text-[#6b6860] font-medium">Year:</span>
          {Array.from({ length: CURRENT_YEAR - 2021 }, (_, i) => 2023 + i).map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${year === y ? 'bg-[#2e9f82] text-white' : 'bg-white border border-[#e8e6e0] text-[#6b6860] hover:border-[#c5c2bc]'}`}>
              {y}
            </button>
          ))}
        </div>
      )}

      {/* Totals */}
      {data && visibleTotals.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
          {visibleTotals.map(t => {
            const raw = data.totals[t.key];
            return (
              <div key={t.key} className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{t.label}</p>
                <p className="text-base font-bold text-[#1a1916] mt-1">
                  {t.type === 'aed' ? fmtAed(raw) : t.type === 'rate' ? `${Number(raw).toFixed(1)}%` : fmtNumber(raw)}
                </p>
              </div>
            );
          })}
        </div>
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
                    <table className="w-full text-sm">
                      <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                        <tr>
                          {dd.columns.map(c => (
                            <th key={c.key} className={`px-4 py-2.5 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                          ))}
                          {dd.contractIdKey && <th className="px-3 py-2.5 print:hidden" aria-hidden />}
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((it, idx) => (
                          <tr key={idx} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                            {dd.columns.map(c => (
                              <td key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>
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
            <table className="text-sm border-collapse min-w-full">
              <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                <tr>
                  <th className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-3 text-left font-semibold min-w-[190px]">Customer</th>
                  {(data?.months ?? []).map(m => (
                    <th key={m} className="px-3 py-3 text-right font-semibold whitespace-nowrap">{m}</th>
                  ))}
                  <th className="px-4 py-3 text-right font-semibold whitespace-nowrap border-l border-[#e8e6e0]">Total</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const cells = (row.cells as { amountFils: number; status: string | null }[]) ?? [];
                  return (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8] print:break-inside-avoid">
                      <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left">
                        <div className="font-medium text-[#1a1916] leading-tight">{String(row.customer ?? '—')}</div>
                        <div className="text-[11px] text-[#9b9890] leading-tight">{[row.unitLabel, row.buildingName].filter(Boolean).map(String).join(' · ')}</div>
                      </td>
                      {cells.map((c, ci) => (
                        <td key={ci} className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${c.amountFils ? (CELL_STATUS_STYLE[c.status ?? ''] ?? 'text-[#1a1916]') : 'text-[#d4d2cc]'}`}>
                          {fmtAmt(c.amountFils)}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold text-[#1a1916] whitespace-nowrap border-l border-[#f0ede8]">{fmtAmt(Number(row.totalFils))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#fafaf8] border-t-2 border-[#e8e6e0] font-bold text-[#1a1916]">
                <tr>
                  <td className="sticky left-0 z-10 bg-[#fafaf8] px-4 py-3 text-left">Total</td>
                  {(data?.columnTotals ?? []).map((t, ti) => (
                    <td key={ti} className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{fmtAmt(t)}</td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums border-l border-[#e8e6e0]">{fmtAmt(data?.totals?.scheduledFils)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-[#f0ede8] text-[11px] text-[#6b6860]">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#15803d]" /> Collected</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#b45309]" /> Pending</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#dc2626]" /> Bounced</span>
            <span className="flex items-center gap-1.5"><span className="text-[#d4d2cc]">·</span> No cheque due</span>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:border-none print:rounded-none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
                  {def.drilldown && <th className="px-3 py-3 print:hidden" aria-hidden />}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const items = def.drilldown ? (row[def.drilldown.childKey] as unknown[] | undefined) : undefined;
                  const canDrill = !!def.drilldown && Array.isArray(items) && items.length > 0;
                  return (
                    <tr
                      key={i}
                      onClick={canDrill ? () => setDrill(row) : undefined}
                      className={`border-t border-[#f0ede8] hover:bg-[#fafaf8] ${canDrill ? 'cursor-pointer print:cursor-auto' : ''}`}>
                      {visibleColumns.map(c => (
                        <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left'} text-[#1a1916]`}>
                          <CellValue value={row[c.key]} type={c.type} />
                        </td>
                      ))}
                      {def.drilldown && (
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
      {def.drilldown && drill && (() => {
        const dd = def.drilldown;
        const items = (drill[dd.childKey] as Record<string, unknown>[] | undefined) ?? [];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden" onClick={() => setDrill(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
                <div>
                  <h3 className="text-base font-bold text-[#1a1916]">{String(drill[dd.titleKey] ?? '')}</h3>
                  <p className="text-xs text-[#6b6860] mt-0.5">{items.length} {dd.countLabel} up for renewal</p>
                </div>
                <button onClick={() => setDrill(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef]">
                  <X size={16} />
                </button>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890] sticky top-0">
                    <tr>
                      {dd.columns.map(c => (
                        <th key={c.key} className={`px-4 py-2.5 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                      ))}
                      {dd.contractIdKey && <th className="px-3 py-2.5" aria-hidden />}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                        {dd.columns.map(c => (
                          <td key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>
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
    </div>
  );
}
