'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

/**
 * Admin — User detail.
 *
 * Shows a summary for any user, plus (for a Landlord / rental_provider) a full
 * breakdown: their properties, units, the customers engaged with them, and
 * their leases. The four breakdown lists are laid out two-per-row and each
 * scrolls internally (capped height) so the page itself stays compact even for
 * a landlord with hundreds of units / leases. Data: GET /admin/users/:id.
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Building2, Home, Users as UsersIcon, FileText, Mail, Phone,
  ShieldCheck, ShieldAlert, BadgeCheck, Clock, ChevronRight,
  Wrench, Truck, MapPin, Star, UserCog, CheckCircle2, Zap, CalendarClock,
  UserX, UserCheck, Banknote, Eye,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { apiGet, apiPatch } from '@/lib/api';
import { openDocViewerByIds } from '@/lib/docViewer';

const roleLabel: Record<string, string> = {
  customer: 'Customer',
  rental_provider: 'Rental Provider',
  service_provider: 'Service Provider',
  technician: 'Technician',
  manager: 'Manager',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

interface UserDetail {
  user: {
    id: number; name: string; firstName: string | null; lastName: string | null;
    email: string; phone: string | null; role: string; status: string;
    kycStatus: string; emailVerified: boolean; phoneVerified: boolean;
    profilePictureUrl: string | null; nationality: string | null;
    createdAt: string; lastLoginAt: string | null;
  };
  landlord: null | {
    profile: {
      rentalProviderId: number; companyName: string | null;
      entityType: string | null; companyType: string | null;
      tradeLicenseNumber: string | null;
      hasPoa?: boolean; poaPersonName?: string | null; poaPersonPhone?: string | null;
      poaPersonEmail?: string | null; poaStatus?: string | null;
    };
    summary: {
      properties: number; units: number; occupiedUnits: number;
      customers: number; leases: number; activeLeases: number;
    };
    properties: { id: number; buildingName: string; spaceCategory: string; fullAddress: string | null; unitCount: number; occupiedCount: number; units: { id: number; unitNumber: string; unitName: string | null; unitType: string; availability: string; rentalPrice: number | null }[] }[];
    units: { id: number; unitNumber: string; unitName: string | null; unitType: string; availability: string; rentalPrice: number | null; propertyId: number; propertyName: string | null }[];
    documents: { id: number; documentKey: string; displayName: string | null; category: string | null; fileUrl: string | null; status: string | null; issueDate: string | null; expiryDate: string | null }[];
    customers: { tenantId: number; userId: number; name: string; email: string | null; phone: string | null; hasLease: boolean; renting?: boolean }[];
    leases: { id: number; status: string; contractStartDate: string | null; contractEndDate: string | null; annualRent: number | null; tenantName: string; unitNumber: string | null; phase?: 'current' | 'awaiting' | 'ended' }[];
    payments: { id: number; contractId: number | null; customerName: string; unitNumber: string | null; paymentType: string | null; paymentMethod: string | null; chequeNumber: string | null; amountPaid: number; vatAmount: number; chequeStatus: string; transactionDate: string | null; description: string | null }[];
    activity: {
      summary: { totalActions: number; last30dActions: number; distinctEntities: number; lastActionAt: string | null };
      recent: { actionKey: string; entityType: string; entityId: number; createdAt: string }[];
    };
    managers: { userId: number; name: string; email: string | null; accountStatus: string | null; grantedAt: string; grantedByRole: string | null; isActive: boolean; grantedCount: number }[];
    settings: {
      feeSchedule: FeeRuleRow[];
      preferences: { startDays: number[] | null; chequeDays: number[] | null; allowedInstallments: number[] | null; rentVatMode: string | null; renewalRentIncrementPct: number | null };
      penalties: Record<string, { enabled: boolean; fee: number | null; pct: number | null; months?: number | null; daily?: boolean }>;
      settlementDiscountCaps: { rentPct: number | null; penaltiesPct: number | null; restorationPct: number | null; utilitiesPct: number | null };
    };
    insights: {
      financials: { marketRent: number; earningUnits: number; unitsAwaitingActivation: number; annualRecurringRent: number; totalContractValue: number; avgRentActive: number; depositsHeld: number; vatCollected: number };
      occupancy: { totalUnits: number; occupiedUnits: number; vacantUnits: number; occupancyPct: number; vacantRentPotential: number };
      collections: { byStatus: Record<string, { count: number; amount: number }>; collectedAmount: number; pendingAmount: number; bouncedCount: number; collectionRatePct: number };
      listings: { byStatus: Record<string, number>; published: number; total: number };
      leaseLifecycle: { byStatus: Record<string, number>; expiring30: number; expiring60: number; expiring90: number; renewalBacklog: number };
      pipeline: { byStage: Record<string, number>; bySource?: Record<string, number>; totalLeads: number; convertedLeads: number; conversionPct: number };
      /** Public listing traffic, from `listing_views` ONLY — never summed with the
       *  other two tracking tables. Optional so an older cached payload still renders. */
      traffic?: {
        views: number; visitors: number; unitsViewed: number; views30: number;
        byReferrer: Record<string, number>;
        topUnits: { unitId: number; unitNumber: string | null; views: number; visitors: number; leads: number; lastViewAt: string | null }[];
      };
      unitMix: Record<string, number>;
    };
  };
  manager?: null | {
    profile: null | {
      assetManagerId: number; jobTitle: string | null; specialization: string | null;
      yearsExperience: number | null; languages: string[]; areasServed: string[];
      rating: number | null; status: string | null;
    };
    summary: { landlords: number; properties: number; units: number; occupiedUnits: number; activeLeases: number; annualRentManaged: number };
    tenure: { since: string | null; days: number | null };
    authority: {
      createContracts: boolean; signDocuments: boolean; actAsPoa: boolean; manageDeposits: boolean;
      settleDeposits: boolean; recordPayments: boolean; clearCheques: boolean;
      manageCollections: boolean; viewFinancials: boolean; manageRenewals: boolean; manageAgreements: boolean;
      manageMaintenance: boolean; listProperties: boolean; publishListings: boolean; manageViewings: boolean;
      manageDocuments: boolean; inviteManager: boolean;
    };
    allPermissions: Record<string, boolean>;
    attributed: {
      contractsSigned: number; auditActions: number; terminations: number; lastActionAt: string | null;
      recent: { actionKey: string; entityType: string; entityId: number; createdAt: string }[];
    };
    records: {
      scopedToLandlords: number;
      properties: { id: number; buildingName: string | null; spaceCategory: string | null; fullAddress: string | null; landlord: string | null; unitCount: number; occupiedCount: number }[];
      units: { id: number; unitNumber: string | null; unitName: string | null; unitType: string | null; availability: string | null; rentalPrice: number | null; propertyId: number; propertyName: string | null; landlord: string | null }[];
      customers: { tenantId: number; userId: number; name: string; email: string | null; phone: string | null; hasLease: boolean }[];
      leases: { id: number; status: string; contractStartDate: string | null; contractEndDate: string | null; annualRent: number | null; tenantName: string; unitNumber: string | null; landlord: string | null }[];
      payments: { id: number; contractId: number | null; customerName: string; unitNumber: string | null; landlord: string | null; paymentType: string | null; paymentMethod: string | null; chequeNumber: string | null; amountPaid: number; vatAmount: number; chequeStatus: string; transactionDate: string | null; description: string | null }[];
      documents: { id: number; documentKey: string; displayName: string | null; category: string | null; fileUrl: string | null; status: string | null; issueDate: string | null; expiryDate: string | null; landlord: string | null }[];
    };
    risk: {
      tier: 'ok' | 'monitor' | 'review' | 'critical'; moneyPower: boolean; dormant: boolean; dormantDays: number | null; signalCount: number;
      signals: { key: string; label: string; severity: 'critical' | 'high' | 'medium' | 'info'; detail: string }[];
    };
    portfolio: null | {
      occupancy: { totalUnits: number; occupiedUnits: number; vacantUnits: number; occupancyPct: number };
      collections: { byStatus: Record<string, { count: number; amount: number }>; collectedAmount: number; pendingAmount: number; bouncedCount: number; collectionRatePct: number };
      leaseLifecycle: { byStatus: Record<string, number>; expiring30: number; expiring60: number; expiring90: number; renewalBacklog: number; startedThisYear: number; renewalsCompleted: number };
      financials: { annualRentManaged: number; totalContractValue: number; depositsHeld: number };
    };
    landlords: { rentalProviderId: number; userId: number | null; companyName: string | null; ownerName: string | null; grantedAt: string | null; tenureDays: number | null; properties: number; units: number; leases: number; activeLeases: number; badges: { poa: boolean; sign: boolean; money: boolean; contracts: boolean }; permissions: Record<string, boolean>; grantedByRole: string | null; isActive: boolean }[];
  };
  customer?: null | {
    profile: null | {
      tenantId: number; companyName: string | null; entityType: string | null;
      tradeLicenseNumber: string | null; tradeLicenseAuthority: string | null;
      emiratesIdNumber: string | null; nationality: string | null;
      gender: string | null; dateOfBirth: string | null;
    };
    summary: { leases: number; activeLeases: number; landlords: number; annualRentActive: number; depositsHeld: number };
    financials: null | { totalBilled: number; totalCollected: number; totalOutstanding: number; vatCollected: number; securityDepositHeld: number };
    notes: { id: number; body: string; authorName: string | null; authorRole: string | null; createdAt: string; leaseId: number; unitNumber: string | null }[];
    leaseDocuments: { leaseId: number; unitNumber: string | null; documents: { id: number; documentKey: string; displayName: string | null; category: string | null; fileUrl: string | null; status: string | null; issueDate: string | null; expiryDate: string | null }[] }[];
    payments: null | { byStatus: Record<string, { count: number; amount: number }>; paidAmount: number; pendingAmount: number; bouncedCount: number };
    documents: null | {
      total: number; verified: number; pending: number; requested: number;
      list?: { id: number; documentKey: string; displayName: string | null; category: string | null; fileUrl: string | null; status: string | null; issueDate: string | null; expiryDate: string | null }[];
    };
    leases: { id: number; status: string; contractStartDate: string | null; contractEndDate: string | null; annualRent: number | null; contractType: string | null; ejariStatus: string | null; securityDeposit: number; listedRent: number | null; discountAmount: number | null; billed: number; collected: number; outstanding: number; unitId: number | null; unitNumber: string | null; rentalProviderId: number | null; ownerUserId: number | null; companyName: string | null }[];
    landlords: { rentalProviderId: number; userId: number | null; companyName: string | null; ownerName: string | null; leases: number }[];
  };
  staff?: null | {
    summary: { totalActions: number; last30dActions: number; distinctEntities: number; lastActionAt: string | null };
    actionsByKey: Record<string, number>;
    recentActions: { actionKey: string; entityType: string; entityId: number; createdAt: string }[];
  };
  sp?: null | {
    profile: null | {
      serviceProviderId: number; businessName: string | null; companyName: string | null;
      ownerName: string | null; entityType: string | null; isGovernment: boolean;
      tradeLicenseNumber: string | null; vatTrn: string | null;
      emiratesServed: string[]; serviceCategories: string[];
      emergencyResponse: boolean; opsContactName: string | null; opsContactPhone: string | null;
    };
    readiness: null | {
      complianceStatus: string; compliancePausedAt: string | null; complianceNotes: string | null;
      jobReadyAt: string | null; jobReady: boolean; jobRulesAcceptedAt: string | null;
      maxConcurrentJobs: number | null; minNoticeHours: number | null;
      teamSizeBand: string | null; fleetSizeBand: string | null;
    };
    summary: {
      services: number; servicesApproved: number; technicians: number; leadTechnicians: number;
      vehicles: number; activeVehicles: number; coverageZones: number; emiratesServed: number;
      bookings: number; completedBookings: number; avgRating: number; totalReviews: number;
    };
    insights: null | {
      catalog: { byStatus: Record<string, number>; total: number; available: number };
      serviceMix: Record<string, number>;
      bookings: { byStatus: Record<string, { count: number; amount: number }>; total: number; completed: number; revenue: number; cancelled: number };
      reviews: { avgRating: number; totalReviews: number; distribution: Record<string, number> };
      availability: { daysCovered: number; shifts: number };
    };
    catalog: { id: number; name: string; category: string; pricingMode: string; basePrice: number | null; priceUnit: string; minCalloutCharge: number | null; listingStatus: string; isAvailable: boolean; isEmergency: boolean }[];
    technicians: { id: number; userId: number | null; name: string; email: string | null; specialization: string | null; status: string | null; isLeadCapable: boolean; complianceStatus: string | null; photoUrl: string | null }[];
    vehicles: { id: number; vehicleType: string; label: string | null; isActive: boolean }[];
    coverageZones: { id: number; nameEn: string; nameAr: string | null; isActive: boolean }[];
    workingHours: { weekday: number; opensAt: string; closesAt: string }[];
    bookings: { id: number; status: string; scheduledAt: string; serviceName: string | null; totalAmount: number | null; customerName: string }[];
    reviews: { id: number; rating: number; title: string | null; body: string | null; createdAt: string; reviewerName: string }[];
    documents: { id: number; documentKey: string; displayName: string | null; category: string | null; fileUrl: string | null; status: string | null; issueDate: string | null; expiryDate: string | null }[];
  };
}

const aed = (n: number | null | undefined) =>
  n == null ? '—' : `AED ${Math.round(Number(n)).toLocaleString('en-AE')}`;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE }) : '—');
const titleCase = (s: string | null | undefined) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '—';

const statusColor: Record<string, { bg: string; color: string }> = {
  active: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  occupied: { bg: '#eff6ff', color: '#1e40af' },
  available: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  pending_verification: { bg: '#fef9eb', color: 'var(--color-gold)' },
  suspended: { bg: '#fef2f2', color: 'var(--color-error)' },
  banned: { bg: '#fef2f2', color: 'var(--color-error)' },
  // SP catalogue / compliance / booking statuses
  approved: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  compliant: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  completed: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  pending: { bg: '#fef9eb', color: 'var(--color-gold)' },
  pending_review: { bg: '#fef9eb', color: 'var(--color-gold)' },
  action_required: { bg: '#fef2f2', color: 'var(--color-error)' },
  rejected: { bg: '#fef2f2', color: 'var(--color-error)' },
  expired: { bg: '#fef2f2', color: 'var(--color-error)' },
  cancelled: { bg: '#fef2f2', color: 'var(--color-error)' },
  paused: { bg: 'var(--color-base-100)', color: 'var(--color-neutral-600)' },
  // Cheque statuses
  cleared: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  bounced: { bg: '#fef2f2', color: 'var(--color-error)' },
};

/**
 * The delegated authorities a landlord can grant a manager, grouped and labelled
 * as the RP-side Team panel presents them. Duplicated here rather than imported
 * from components/dashboard/rp/TeamPanel so the admin bundle doesn't pull in the
 * whole RP invite UI — keep the two in step when permissions change.
 *
 * `money` marks the authorities that move or reconcile cash; they get a stronger
 * treatment because this page is where manager risk is reviewed.
 */
const PERM_GROUPS: { label: string; perms: { key: string; label: string; money?: boolean }[] }[] = [
  { label: 'Leads & viewings', perms: [
    { key: 'can_manage_viewings', label: 'Manage leads & viewings' },
    { key: 'can_create_leads', label: 'Add new leads' },
    { key: 'can_review_lead_documents', label: 'Review & request customer documents on leads' },
  ] },
  { label: 'Properties & units', perms: [
    { key: 'can_list_properties', label: 'View properties & units' },
    { key: 'can_edit_properties', label: 'Edit property & unit details' },
    { key: 'can_publish_listings', label: 'Publish / unpublish listings' },
    { key: 'can_manage_documents', label: 'Upload & manage documents' },
  ] },
  { label: 'Leases & contracts', perms: [
    { key: 'can_manage_agreements', label: 'View & manage leases + customers' },
    { key: 'can_create_contracts', label: 'Create new contracts' },
    { key: 'can_manage_contract_lifecycle', label: 'Issue / activate / cancel leases' },
    { key: 'can_manage_renewals', label: 'Manage contract renewals' },
    { key: 'can_manage_termination', label: 'Terminate leases' },
    { key: 'can_manage_inspections', label: 'Inspections & Restoration List' },
    { key: 'can_sign_documents', label: 'Sign tenancy contracts', money: true },
    { key: 'can_sign_addenda', label: 'Sign addenda & amendments', money: true },
    { key: 'can_manage_ejari', label: 'Register / manage Contract Registration' },
    { key: 'can_act_as_poa', label: 'Act with full POA', money: true },
  ] },
  { label: 'Payments & deposits', perms: [
    { key: 'can_manage_deposits', label: 'Manage security deposits', money: true },
    { key: 'can_settle_deposits', label: 'Settle deposits (refund / deduct)', money: true },
    { key: 'can_record_payments', label: 'Record & edit payments', money: true },
    { key: 'can_clear_cheques', label: 'Change cheque status', money: true },
    { key: 'can_manage_collections', label: 'Manage rent collections', money: true },
    { key: 'can_view_financials', label: 'View financial statements', money: true },
  ] },
  { label: 'Other', perms: [
    { key: 'can_manage_templates', label: 'Manage addendum templates' },
    { key: 'can_manage_maintenance', label: 'Handle AMC & maintenance' },
    { key: 'can_communicate_tenants', label: 'Communicate with customers' },
    { key: 'can_view_reports', label: 'Access reports section' },
    { key: 'can_invite_manager', label: 'Invite other managers', money: true },
    { key: 'can_escalate_to_admin', label: 'Escalate to UpNow admin' },
  ] },
];

const ROW = 'rounded-xl px-3 py-2.5 flex flex-wrap items-center gap-3';
const ROW_STYLE = { border: '1px solid var(--color-base-200)', backgroundColor: '#fff' };

// ── Charts (recharts) — palette/conventions shared with the admin dashboard ──
const CHART = { teal: '#2e9f82', amber: '#d97706', red: '#dc2626', blue: '#2563eb', purple: '#7c3aed', gray: '#d4d2cc' };
const tooltipStyle = { borderRadius: 12, border: '1px solid #e8e6e0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };
// Millions collapse to "19M" rather than "19000K": a portfolio's cleared-rent
// axis runs to eight figures, and the K form overflows the 38px axis gutter and
// renders clipped ("0000K").
const aedAxis = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${Math.round(v / 1_000_000)}M`
    : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}K`
      : String(v);
const leaseStatusColor: Record<string, string> = {
  active: CHART.teal, expired: CHART.gray, terminated: CHART.red, pending: CHART.amber, issued: CHART.blue,
};

/**
 * The one card shell, matching the admin Pulse dashboard: a hairline border
 * rather than a drop shadow. Fifteen cards each carrying their own shadow is
 * what made this page read as noise instead of as a set of sections.
 */
const CARD = 'bg-white rounded-2xl border border-[#e8e6e0] p-4';

/**
 * Section divider, lifted from the Pulse dashboard: a numbered category label
 * over the QUESTION that section answers. The question is the point — it tells
 * an admin what they are meant to learn from the cards underneath, which a bare
 * noun like "Financials" never did.
 */
function SectionHead({ no, q, id }: { no: string; q: string; id: string }) {
  return (
    <div id={id} className="flex items-baseline gap-3 mt-8 mb-3 pt-4 border-t border-[#e0ded8] scroll-mt-20">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#1e5fae]">{no}</span>
      <h2 className="text-[15px] font-bold text-[#1a1916]">{q}</h2>
    </div>
  );
}

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className={CARD}>
      <h3 className="text-sm font-bold text-[#1a1916]">{title}</h3>
      {sub && <p className="text-[11px] text-[#9b9890] mt-0.5">{sub}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * Simple vertical bar chart over [{name,value,fill?}]. AED toggles K-axis + currency tooltip.
 *
 * `labelKey` prints an exact figure above each bar. It exists so the chart can be
 * the ONLY home for its numbers: a K-rounded axis is too coarse to read a real
 * figure off, which is what used to justify a panel below repeating every bar as
 * a label/value row. Point it at `count` (with `aedMode`) to get bar = amount,
 * label = cheque count in a single mark.
 */
type BarDatum = { name: string; value: number; fill?: string; count?: number };
function CountBars({ data, aedMode, labelKey }: { data: BarDatum[]; aedMode?: boolean; labelKey?: 'value' | 'count' }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} interval={0} />
        <YAxis allowDecimals={false} tickFormatter={aedMode ? aedAxis : undefined} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} width={aedMode ? 38 : 28} />
        <Tooltip
          formatter={(v: unknown) => [aedMode ? aed(Number(v)) : String(v), aedMode ? 'Amount' : 'Count'] as [string, string]}
          contentStyle={tooltipStyle}
          cursor={{ fill: '#fafaf8' }}
        />
        {/* LabelList must precede the Cells and carry its text attributes via
            `style` — as direct props, or placed after the Cells, recharts drops
            the labels silently and the exact figures are lost. */}
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {labelKey && <LabelList dataKey={labelKey} position="top" style={{ fontSize: 10, fill: '#6b6860' }} />}
          {data.map((d, i) => <Cell key={i} fill={d.fill ?? CHART.teal} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut with a centred big-number/label overlay. */
function Donut({ data, center, label }: { data: { name: string; value: number; fill: string }[]; center: string; label: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={total ? data : [{ name: 'None', value: 1, fill: CHART.gray }]} dataKey="value" nameKey="name" innerRadius={50} outerRadius={72} paddingAngle={total ? 2 : 0} startAngle={90} endAngle={-270} stroke="none">
            {(total ? data : [{ name: 'None', value: 1, fill: CHART.gray }]).map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Pie>
          {total > 0 && <Tooltip contentStyle={tooltipStyle} />}
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-bold leading-none" style={{ color: 'var(--color-neutral-900)' }}>{center}</span>
        <span className="text-[10px] mt-1" style={{ color: 'var(--color-neutral-400)' }}>{label}</span>
      </div>
    </div>
  );
}

/** Small legend row for donut slices. */
function Legend({ items }: { items: { name: string; value: number; fill: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
      {items.map((d) => (
        <span key={d.name} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-neutral-500)' }}>
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: d.fill }} />
          {d.name} <span className="font-semibold" style={{ color: 'var(--color-neutral-700)' }}>{d.value}</span>
        </span>
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3.5 h-full">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-[#9b9890]">{label}</p>
      <p className="text-xl font-bold mt-1.5 leading-none tabular-nums truncate" style={{ color: accent ?? '#1a1916' }}>{value}</p>
      {sub && <p className="text-[11px] text-[#9b9890] mt-1.5">{sub}</p>}
    </div>
  );
}

function MiniPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={CARD}>
      <h3 className="text-sm font-bold text-[#1a1916] mb-3">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KV({ label, value, dot }: { label: string; value: React.ReactNode; dot?: string }) {
  return (
    <div className="flex items-center justify-between text-sm gap-3">
      <span className="flex items-center gap-2 min-w-0" style={{ color: 'var(--color-neutral-600)' }}>
        {dot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="font-semibold flex-shrink-0" style={{ color: 'var(--color-neutral-900)' }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--color-base-200)', margin: '8px 0' }} />;
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-neutral-400)' }}>{children}</p>;
}

/** Human labels for the landlord's configurable penalties, in RP-settings order. */
type FeeRuleRow = {
  id: number; spaceCategory: string | null; feeType: string | null; valueType: string | null;
  value: number; vatApplicable: boolean; vatRate: number; isActive: boolean;
};

/**
 * fee_rules.fee_type → display label. `ejari_fee` keeps its government key in the
 * data and on the printed certificate, but reads as "Contract registration" in
 * product surfaces — see the Ejari rename.
 */
const FEE_TYPE_LABELS: Record<string, string> = {
  ejari_fee: 'Contract registration',
  admin_fee: 'Admin fee',
  commission: 'Commission',
  security_deposit: 'Security deposit',
  rent_vat: 'VAT on rent',
};

const PENALTY_LABELS: [string, string][] = [
  ['bouncedCheque', 'Bounced cheque'],
  ['chequeHold', 'Cheque hold'],
  ['chequeDeferral', 'Cheque deferral / replacement'],
  ['lateRenewal', 'Late renewal'],
  ['earlyTermination', 'Early termination'],
  ['lateMoveout', 'Late move-out'],
  ['unauthorizedSharing', 'Sharing without notice / NOC'],
  ['accessCardReplacement', 'Access card / remote replacement'],
  ['contractNameChange', 'Contract name change'],
  ['unitTransfer', 'Unit transfer'],
];

/** "AED 500", "5%", "AED 500 + 5%". Null when the landlord charges nothing. */
function penaltyValue(p: { enabled: boolean; fee: number | null; pct: number | null; months?: number | null; daily?: boolean } | undefined): string | null {
  if (!p || !p.enabled) return null;
  const bits: string[] = [];
  if (p.fee != null && p.fee > 0) bits.push(aed(p.fee));
  if (p.pct != null && p.pct > 0) bits.push(`${p.pct}%`);
  if (p.months != null && p.months > 0) bits.push(`${p.months} mo rent`);
  if (!bits.length) return null;
  return bits.join(' + ') + (p.daily ? ' / day' : '');
}

type LandlordInsights = NonNullable<UserDetail['landlord']>['insights'];

/**
 * The landlord's insight cards, split into named pieces rather than one block.
 *
 * They used to render as a single strip-charts-panels slab, which is why the
 * page had no categories: there was nowhere to put a section boundary. Each
 * piece now goes under the section whose question it answers.
 */
function insightData(ins: LandlordInsights) {
  const ls = ins.leaseLifecycle, col = ins.collections, o = ins.occupancy;
  return {
    occData: [
      { name: 'Occupied', value: o.occupiedUnits, fill: CHART.teal },
      { name: 'Vacant', value: o.vacantUnits, fill: CHART.gray },
    ],
    statusData: Object.entries(ls.byStatus).map(([k, v]) => ({ name: titleCase(k), value: v, fill: leaseStatusColor[k] ?? CHART.blue })),
    // Bar height is the AMOUNT, the label printed on the bar is the cheque COUNT.
    collData: [
      { name: 'Cleared', value: col.byStatus.cleared?.amount ?? 0, count: col.byStatus.cleared?.count ?? 0, fill: CHART.teal },
      { name: 'Pending', value: col.byStatus.pending?.amount ?? 0, count: col.byStatus.pending?.count ?? 0, fill: CHART.amber },
      { name: 'Bounced', value: col.byStatus.bounced?.amount ?? 0, count: col.byStatus.bounced?.count ?? 0, fill: CHART.red },
    ],
  };
}

const byCountDesc2 = (a: [string, number], b: [string, number]) => b[1] - a[1];

/** Headline money — the three figures, all on the current-book basis. */
function MoneyKpis({ ins }: { ins: LandlordInsights }) {
  const f = ins.financials, o = ins.occupancy, col = ins.collections;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Asking vs contracted, side by side. Market rent is Σ units.rental_price. */}
      <KpiCard label="Market rent (asking)" value={aed(f.marketRent)} sub={`${o.totalUnits} units · ${aed(o.vacantRentPotential)} vacant`} />
      {/* The denominator is stated because it is NOT the occupied count: a term
          with confirmed PDCs earns before its unit flips to occupied. */}
      <KpiCard
        label="Annual recurring rent"
        value={aed(f.annualRecurringRent)}
        sub={
          f.unitsAwaitingActivation > 0
            ? `${f.earningUnits} earning · ${f.unitsAwaitingActivation} on confirmed cheques`
            : `${f.earningUnits} earning units · avg ${aed(f.avgRentActive)}`
        }
        accent="var(--color-primary)"
      />
      <KpiCard label="Rent collected" value={aed(col.collectedAmount)} sub="cleared rent, current leases" />
    </div>
  );
}

function OccupancyCard({ ins }: { ins: LandlordInsights }) {
  const { occData } = insightData(ins);
  return (
    <ChartCard title="Occupancy" sub="units marked occupied">
      <Donut data={occData} center={`${ins.occupancy.occupancyPct}%`} label="occupied" />
      <Legend items={occData} />
    </ChartCard>
  );
}

function ListingsPanel({ ins }: { ins: LandlordInsights }) {
  return (
    <MiniPanel title="Listings & unit mix">
      <Caption>Listing status</Caption>
      {Object.entries(ins.listings.byStatus).sort(byCountDesc2).map(([k, v]) => <KV key={k} label={titleCase(k)} value={v} />)}
      <Divider />
      <Caption>Unit mix</Caption>
      {Object.entries(ins.unitMix).sort(byCountDesc2).map(([k, v]) => <KV key={k} label={titleCase(k)} value={v} />)}
    </MiniPanel>
  );
}

function LeaseMixCard({ ins }: { ins: LandlordInsights }) {
  const { statusData } = insightData(ins);
  return (
    <ChartCard title="Lease status mix" sub="all tenancies">
      <CountBars data={statusData} labelKey="value" />
    </ChartCard>
  );
}

/** Bar = amount, printed label = cheque count. */
function CollectionsCard({ ins }: { ins: LandlordInsights }) {
  const { collData } = insightData(ins);
  return (
    <ChartCard title="Collections" sub="cheque amounts by status · labels are counts">
      <CountBars data={collData} aedMode labelKey="count" />
    </ChartCard>
  );
}

function FinancialsPanel({ ins }: { ins: LandlordInsights }) {
  const f = ins.financials, col = ins.collections;
  return (
    <MiniPanel title="Financials & collections">
      <KV label="Total contract value" value={aed(f.totalContractValue)} />
      <KV label="VAT collected" value={aed(f.vatCollected)} />
      {/* Held against the whole tenancy CHAIN, not the current term — on a
          renewal the deposit stays on the root lease. See users.service. */}
      <KV label="Deposits held" value={aed(f.depositsHeld)} />
      <Divider />
      {/* Per-status cheque counts and amounts are NOT repeated here — the
          Collections chart owns them (bars = amount, labels = count). */}
      <KV label="Collection rate" value={`${col.collectionRatePct}%`} />
    </MiniPanel>
  );
}

/**
 * Listing traffic — how much public interest the listings actually attract.
 *
 * Read from `listing_views` alone. The platform has three tracking tables and
 * only this one carries a unit id, so it is the only one attributable to a
 * landlord; the other two overlap with it and must never be added to it. The
 * card states its source so nobody later "completes" the number by summing.
 *
 * Views are shown against LEADS, not on their own: no views and views-without-
 * enquiries are opposite problems with opposite fixes, and a bare view count
 * cannot tell them apart.
 */
function TrafficPanel({ ins }: { ins: LandlordInsights }) {
  const t = ins.traffic;
  if (!t) return null;
  const lst = ins.listings;
  // Views per visitor, and the share of the book anyone has ever looked at.
  const perVisitor = t.visitors ? (t.views / t.visitors).toFixed(1) : '—';
  const refs = Object.entries(t.byReferrer).sort((a, b) => b[1] - a[1]);
  return (
    <MiniPanel title="Listing traffic">
      <p className="text-xs mb-2" style={{ color: 'var(--color-neutral-400)' }}>
        Public views of this landlord&apos;s listings, from listing views only — not combined with
        portal page views or site visits, which count different things.
      </p>
      <KV label="Listing views" value={t.views} />
      <KV label="Unique visitors" value={`${t.visitors}${t.visitors ? ` · ${perVisitor} views each` : ''}`} />
      <KV label="Views in last 30 days" value={t.views30} />
      <Divider />
      {/* Against the LISTED count, not the total unit count: an unpublished unit
          has no page to be viewed, so counting it as unviewed is not a finding. */}
      <KV
        label="Listings viewed"
        value={`${t.unitsViewed} of ${lst.published} published`}
        dot={lst.published > 0 && t.unitsViewed < lst.published ? 'var(--color-gold)' : undefined}
      />
      {refs.length > 0 && (
        <>
          <Divider />
          <Caption>Came from</Caption>
          {refs.map(([k, v]) => <KV key={k} label={k} value={v} />)}
        </>
      )}
    </MiniPanel>
  );
}

/** The listings people actually opened, each against the leads it produced. */
function TopViewedPanel({ ins }: { ins: LandlordInsights }) {
  const rows = ins.traffic?.topUnits ?? [];
  return (
    <Section title="Most-viewed listings" count={rows.length}>
      <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
        Views beside the leads each unit produced — traffic with no enquiry is a different
        problem from no traffic at all.
      </p>
      {rows.map((r) => (
        <Link key={r.unitId} href={`/dashboard/admin/units/${r.unitId}`} className={`${ROW} transition-colors hover:brightness-95`} style={ROW_STYLE}>
          <Eye size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
              {r.unitNumber ? `Unit ${r.unitNumber}` : `Unit #${r.unitId}`}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
              {r.views} view{r.views === 1 ? '' : 's'} · {r.visitors} visitor{r.visitors === 1 ? '' : 's'}
              {r.lastViewAt ? ` · last ${fmtDate(r.lastViewAt)}` : ''}
            </p>
          </div>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
            style={r.leads > 0
              ? { backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }
              : { backgroundColor: '#fef9eb', color: 'var(--color-gold)' }}>
            {r.leads > 0 ? `${r.leads} lead${r.leads === 1 ? '' : 's'}` : 'no enquiry'}
          </span>
          <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />
        </Link>
      ))}
    </Section>
  );
}

function PipelinePanel({ ins }: { ins: LandlordInsights }) {
  const pl = ins.pipeline;
  return (
    <MiniPanel title="Demand pipeline">
      <KV label="Total leads" value={pl.totalLeads} />
      <KV label="Converted" value={`${pl.convertedLeads} (${pl.conversionPct}%)`} />
      {Object.keys(pl.bySource ?? {}).length > 0 && (
        <>
          <Divider />
          <Caption>Lead source</Caption>
          {Object.entries(pl.bySource ?? {}).sort(byCountDesc2).map(([k, v]) => <KV key={k} label={titleCase(k)} value={v} />)}
        </>
      )}
      <Divider />
      <Caption>Stage</Caption>
      {pl.totalLeads === 0
        ? <p className="text-sm" style={{ color: 'var(--color-neutral-400)' }}>No platform leads yet.</p>
        : Object.entries(pl.byStage).sort(byCountDesc2).map(([k, v]) => <KV key={k} label={titleCase(k)} value={v} />)}
    </MiniPanel>
  );
}

/** A breakdown card: header (title + count) and an internally-scrolling body. */
function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] flex flex-col overflow-hidden" style={{ maxHeight: 440 }}>
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-base-200)' }}>
        <h3 className="text-sm font-bold text-[#1a1916]">{title}</h3>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>{count}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {count === 0
          ? <p className="text-sm py-2 text-center" style={{ color: 'var(--color-neutral-400)' }}>None.</p>
          : children}
      </div>
    </div>
  );
}

function Pill({ value }: { value: string }) {
  const sc = statusColor[value] ?? { bg: 'var(--color-base-100)', color: 'var(--color-neutral-600)' };
  return <span className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0" style={{ backgroundColor: sc.bg, color: sc.color }}>{value.replace(/_/g, ' ')}</span>;
}

/**
 * One owned document — name, category, expiry, and a View button that opens it
 * through the secure viewer. An empty fileUrl means the document was requested
 * but never uploaded. Shared by the landlord, customer and SP breakdowns.
 */
type OwnedDoc = {
  id: number; documentKey: string; displayName: string | null; category: string | null;
  fileUrl: string | null; expiryDate: string | null;
};
/** `sub` prefixes the meta line — the manager view uses it to name the owning landlord. */
function DocRow({ d, sub }: { d: OwnedDoc; sub?: string }) {
  const label = d.displayName || titleCase((d.documentKey || '').replace(/_/g, ' '));
  return (
    <div className={ROW} style={ROW_STYLE}>
      <FileText size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{label}</p>
        <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
          {sub ? `${sub} · ` : ''}{d.category ? titleCase(d.category) : '—'}{d.expiryDate ? ` · expires ${fmtDate(d.expiryDate)}` : ''}
        </p>
      </div>
      {/* Opened by id, not by file_url: the stored URL points straight at a
          private bucket that 403s an anonymous browser fetch, so the viewer used
          to open on a document it could never load. See openDocViewerByIds. */}
      {d.fileUrl ? (
        <button type="button" onClick={() => void openDocViewerByIds([{ id: d.id, caption: label }], label)} className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 cursor-pointer" style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }}>View</button>
      ) : (
        <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>Requested</span>
      )}
    </div>
  );
}

/**
 * Power of Attorney — the holder and the paperwork, lifted out of the flat
 * document list.
 *
 * Two reasons it is its own block. A POA row buried in a mixed document list is
 * just another filename, when it is the instrument that lets somebody else sign
 * for this landlord. And a flat list can only render what EXISTS: with no POA
 * section, a landlord who declared a POA but never uploaded the deed looked
 * identical to one who has no POA at all. Absence is stated here, not left to be
 * inferred from a row that simply is not there.
 *
 * `poa_*` is the same prefix rule the admin KYC page groups these by, so both
 * surfaces agree on what counts as POA paperwork.
 */
function PoaPanel({ profile, docs }: {
  profile: NonNullable<UserDetail['landlord']>['profile'];
  docs: OwnedDoc[];
}) {
  // The deed itself. `poa_document` is the signed Power of Attorney; every other
  // poa_* key is supporting identity for the holder.
  const hasDeed = docs.some((d) => d.documentKey === 'poa_document' && !!d.fileUrl);
  const holder = ([
    ['Holder', profile.poaPersonName],
    ['Phone', profile.poaPersonPhone],
    ['Email', profile.poaPersonEmail],
  ] as [string, string | null | undefined][]).filter((r): r is [string, string] => !!r[1]);

  return (
    <div className="bg-white rounded-2xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <ShieldCheck size={15} style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>Power of Attorney</h3>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={profile.hasPoa
            ? { backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }
            : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>
          {profile.hasPoa ? 'Declared' : 'Not declared'}
        </span>
        {profile.poaStatus && <Pill value={profile.poaStatus} />}
      </div>

      {holder.length > 0
        ? <div className="space-y-1.5 mb-3">{holder.map(([l, v]) => <KV key={l} label={l} value={v} />)}</div>
        : <p className="text-sm mb-3" style={{ color: 'var(--color-neutral-400)' }}>No POA holder recorded.</p>}

      {!hasDeed && (
        <p className="text-xs mb-2 px-2.5 py-2 rounded-lg" style={{ backgroundColor: '#fef9eb', color: 'var(--color-gold)' }}>
          No signed Power of Attorney deed on file
          {profile.hasPoa ? ' — yet this landlord has declared one.' : '.'}
          {docs.length > 0 && ' The documents below are holder identity only.'}
        </p>
      )}

      <div className="space-y-1.5">
        {docs.length === 0
          ? <p className="text-sm" style={{ color: 'var(--color-neutral-400)' }}>No POA documents uploaded.</p>
          : docs.map((d) => <DocRow key={d.id} d={d} />)}
      </div>
    </div>
  );
}

/**
 * One customer in the landlord's roster. The chip states which of the three
 * buckets the row is in, so a card read out of context still says what it is.
 */
function CustomerRow({ c, tone }: {
  c: { tenantId: number; userId: number; name: string; email: string | null; phone: string | null; hasLease: boolean; renting?: boolean };
  tone: 'active' | 'ended' | 'lead';
}) {
  const chip = tone === 'active'
    ? { label: 'Renting', bg: 'var(--color-primary-50)', fg: 'var(--color-primary)' }
    : tone === 'ended'
      ? { label: 'Ended', bg: 'var(--color-base-100)', fg: 'var(--color-neutral-500)' }
      : { label: 'Never signed', bg: '#fef9eb', fg: 'var(--color-gold)' };
  return (
    <Link href={`/dashboard/admin/users/${c.userId}`} className={`${ROW} transition-colors hover:brightness-95`} style={ROW_STYLE}>
      <UsersIcon size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{c.name}</p>
        <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{c.email ?? '—'}{c.phone ? ` · ${c.phone}` : ''}</p>
      </div>
      <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: chip.bg, color: chip.fg }}>{chip.label}</span>
      <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />
    </Link>
  );
}

/** One lease row. `payments` is the count hanging off it, shown when non-zero. */
function LeaseRow({ c, payments }: {
  c: { id: number; status: string; contractStartDate: string | null; contractEndDate: string | null; annualRent: number | null; tenantName: string; unitNumber: string | null };
  payments?: number;
}) {
  return (
    <div className={ROW} style={ROW_STYLE}>
      <FileText size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
          {c.tenantName}
          {c.unitNumber && <span className="font-normal" style={{ color: 'var(--color-neutral-400)' }}> · Unit {c.unitNumber}</span>}
        </p>
        <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>
          {fmtDate(c.contractStartDate)} → {fmtDate(c.contractEndDate)} · {aed(c.annualRent)}/yr
          {(payments ?? 0) > 0 && ` · ${payments} payment${payments === 1 ? '' : 's'}`}
        </p>
      </div>
      <Pill value={c.status} />
    </div>
  );
}

/** Whole years since a date of birth, or null if unparseable. */
function ageFrom(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** Human duration from a day count: "today" / "12 days" / "5 mo" / "1y 3mo". */
function fmtDuration(days: number | null): string {
  if (days == null) return '—';
  if (days < 1) return 'today';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}mo` : `${years} yr${years === 1 ? '' : 's'}`;
}

function ProfileBit({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ color: 'var(--color-neutral-400)' }}>{label}: </span>
      <span style={{ color: 'var(--color-neutral-800)', fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function MiniBadge({ label }: { label: string }) {
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }}>{label}</span>;
}

const byCountDesc = (a: [string, number], b: [string, number]) => b[1] - a[1];

const sevStyle: Record<string, { dot: string; chip: string; text: string }> = {
  critical: { dot: '#dc2626', chip: '#fef2f2', text: '#dc2626' },
  high: { dot: '#ea580c', chip: '#fff7ed', text: '#c2410c' },
  medium: { dot: '#d97706', chip: '#fef9eb', text: '#b45309' },
  info: { dot: '#6b7280', chip: '#f3f4f6', text: '#4b5563' },
};
const tierStyle: Record<string, { label: string; bg: string; fg: string; accent: string }> = {
  ok: { label: 'No concerns', bg: 'var(--color-primary-50)', fg: 'var(--color-primary)', accent: 'var(--color-primary)' },
  monitor: { label: 'Monitor', bg: '#eff6ff', fg: '#1e40af', accent: '#2563eb' },
  review: { label: 'Review', bg: '#fef9eb', fg: '#b45309', accent: '#d97706' },
  critical: { label: 'Critical', bg: '#fef2f2', fg: '#dc2626', accent: '#dc2626' },
};

/** Suspicious-behaviour / oversight panel for a manager. */
function RiskPanel({ risk }: { risk: NonNullable<UserDetail['manager']>['risk'] }) {
  const t = tierStyle[risk.tier] ?? tierStyle.ok;
  return (
    <div className="bg-white rounded-2xl p-4 mb-4" style={{ boxShadow: 'var(--shadow-sm)', borderLeft: `3px solid ${t.accent}` }}>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <ShieldAlert size={16} style={{ color: t.accent }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>Risk &amp; oversight</h3>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: t.bg, color: t.fg }}>{t.label}</span>
        {risk.signalCount > 0 && <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>{risk.signalCount} signal{risk.signalCount === 1 ? '' : 's'}</span>}
      </div>
      {risk.signals.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>No suspicious behaviour or excess-authority signals detected for this manager.</p>
      ) : (
        <div className="space-y-2 mt-2">
          {risk.signals.map((sg) => {
            const ss = sevStyle[sg.severity] ?? sevStyle.info;
            return (
              <div key={sg.key} className="flex items-start gap-2.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: ss.dot }} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>{sg.label}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide" style={{ backgroundColor: ss.chip, color: ss.text }}>{sg.severity}</span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>{sg.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Link href="/dashboard/admin/risk" className="inline-flex items-center gap-1 text-xs font-medium mt-3" style={{ color: 'var(--color-primary)' }}>
        Open manager risk board <ChevronRight size={13} />
      </Link>
    </div>
  );
}

/** Manager breakdown — landlords worked for, authority, attributed activity, portfolio. */
function ManagerView({ m }: { m: NonNullable<UserDetail['manager']> }) {
  const s = m.summary, p = m.portfolio, a = m.attributed, t = m.tenure, auth = m.authority;
  const prof = m.profile;
  const rec = m.records;
  // Units nested under their building, as on the landlord page.
  const unitsByProp = (rec?.units ?? []).reduce<Record<number, NonNullable<typeof rec>['units']>>((acc, u) => {
    (acc[u.propertyId] ??= []).push(u);
    return acc;
  }, {});
  const occData = p ? [
    { name: 'Occupied', value: p.occupancy.occupiedUnits, fill: CHART.teal },
    { name: 'Vacant', value: p.occupancy.vacantUnits, fill: CHART.gray },
  ] : [];
  const statusData = p ? Object.entries(p.leaseLifecycle.byStatus).map(([k, v]) => ({ name: titleCase(k), value: v, fill: leaseStatusColor[k] ?? CHART.blue })) : [];
  const collData = p ? [
    { name: 'Cleared', value: p.collections.byStatus.cleared?.amount ?? 0, fill: CHART.teal },
    { name: 'Pending', value: p.collections.byStatus.pending?.amount ?? 0, fill: CHART.amber },
    { name: 'Bounced', value: p.collections.byStatus.bounced?.amount ?? 0, fill: CHART.red },
  ] : [];
  // Full grant matrix. Falls back to the legacy 14-flag `authority` object so an
  // older cached payload still renders something sensible.
  const perms: Record<string, boolean> = m.allPermissions ?? {
    can_create_contracts: auth.createContracts, can_sign_documents: auth.signDocuments,
    can_act_as_poa: auth.actAsPoa, can_manage_deposits: auth.manageDeposits,
    can_settle_deposits: auth.settleDeposits, can_record_payments: auth.recordPayments,
    can_clear_cheques: auth.clearCheques,
    can_manage_collections: auth.manageCollections, can_view_financials: auth.viewFinancials,
    can_manage_renewals: auth.manageRenewals, can_manage_agreements: auth.manageAgreements,
    can_manage_maintenance: auth.manageMaintenance, can_list_properties: auth.listProperties,
    can_publish_listings: auth.publishListings, can_manage_viewings: auth.manageViewings,
    can_manage_documents: auth.manageDocuments, can_invite_manager: auth.inviteManager,
  };
  const allPerms = PERM_GROUPS.flatMap((g) => g.perms);
  const totalPerms = allPerms.length;
  const grantedCount = allPerms.filter((p) => perms[p.key]).length;
  const moneyGrants = allPerms.filter((p) => p.money && perms[p.key]);
  const hasProfile = !!prof && (!!prof.jobTitle || !!prof.specialization || prof.yearsExperience != null || prof.rating != null || (prof.languages?.length ?? 0) > 0 || (prof.areasServed?.length ?? 0) > 0);
  return (
    <>
      {hasProfile && prof && (
        <div className="bg-white rounded-2xl p-4 mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm" style={{ boxShadow: 'var(--shadow-sm)' }}>
          {prof.jobTitle && <ProfileBit label="Title" value={prof.jobTitle} />}
          {prof.specialization && <ProfileBit label="Specialization" value={prof.specialization} />}
          {prof.yearsExperience != null && <ProfileBit label="Experience" value={`${prof.yearsExperience} yrs`} />}
          {prof.rating != null && <ProfileBit label="Rating" value={`${prof.rating}/5`} />}
          {(prof.languages?.length ?? 0) > 0 && <ProfileBit label="Languages" value={prof.languages.join(', ')} />}
          {(prof.areasServed?.length ?? 0) > 0 && <ProfileBit label="Areas" value={prof.areasServed.join(', ')} />}
        </div>
      )}

      {/* Suspicious behaviour / oversight — surfaced first */}
      <RiskPanel risk={m.risk} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <KpiCard label="Landlords managed" value={s.landlords} sub={t.since ? `since ${fmtDate(t.since)}` : 'no grants yet'} accent="var(--color-primary)" />
        <KpiCard label="Tenure" value={fmtDuration(t.days)} sub={t.since ? `first grant ${fmtDate(t.since)}` : '—'} />
        <KpiCard label="Units managed" value={s.units} sub={`${s.properties} properties`} />
        <KpiCard label="Active leases" value={s.activeLeases} sub="under management" />
        <KpiCard label="Annual rent managed" value={aed(s.annualRentManaged)} sub="active leases" />
        <KpiCard label="Portfolio occupancy" value={p ? `${p.occupancy.occupancyPct}%` : '—'} sub={p ? `${p.occupancy.occupiedUnits}/${p.occupancy.totalUnits} occupied` : ''} />
      </div>

      {/* Charts — portfolio at a glance */}
      {p && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <ChartCard title="Portfolio occupancy" sub={`${p.occupancy.occupiedUnits}/${p.occupancy.totalUnits} units occupied`}>
            <Donut data={occData} center={`${p.occupancy.occupancyPct}%`} label="occupied" />
            <Legend items={occData} />
          </ChartCard>
          <ChartCard title="Lease status mix" sub="across managed landlords">
            <CountBars data={statusData} />
          </ChartCard>
          <ChartCard title="Collections" sub="cheque amounts by status">
            <CountBars data={collData} aedMode />
          </ChartCard>
        </div>
      )}

      {/* Attributed activity + authority */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <MiniPanel title="Attributed to this manager">
          <p className="text-xs mb-2" style={{ color: 'var(--color-neutral-400)' }}>What this manager personally did. Most manager work is still logged under the landlord, so these may read low.</p>
          <KV label="Contracts signed" value={a.contractsSigned} />
          <KV label="Terminations performed" value={a.terminations} dot={a.terminations > 0 ? 'var(--color-gold)' : undefined} />
          <KV label="Logged actions" value={a.auditActions} />
          <KV label="Last action" value={a.lastActionAt ? fmtDate(a.lastActionAt) : '—'} />
        </MiniPanel>

        <MiniPanel title="Authority footprint">
          <p className="text-xs mb-2" style={{ color: 'var(--color-neutral-400)' }}>
            Every permission a landlord can delegate, held for at least one managed landlord.{' '}
            {grantedCount} of {totalPerms} granted{moneyGrants.length > 0 ? ` · ${moneyGrants.length} move or reconcile money` : ''}.
          </p>
          {PERM_GROUPS.map((g) => (
            <div key={g.label} className="mb-2.5 last:mb-0">
              <Caption>{g.label}</Caption>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {g.perms.map((p) => {
                  const on = perms[p.key] === true;
                  const style = on
                    ? p.money
                      ? { backgroundColor: '#fef2f2', color: 'var(--color-error)', border: '1px solid #fecaca' }
                      : { backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)', border: '1px solid transparent' }
                    : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-400)', border: '1px solid transparent' };
                  return (
                    <span key={p.key} className="text-xs font-medium px-2 py-1 rounded-full" style={style}>
                      {on ? '✓ ' : ''}{p.label}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </MiniPanel>
      </div>

      {/* Portfolio outcomes */}
      {p && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <MiniPanel title="Portfolio outcomes (across managed landlords)">
            <KV label="Leases started this year" value={p.leaseLifecycle.startedThisYear} />
            <KV label="Renewals completed" value={p.leaseLifecycle.renewalsCompleted} />
            <Divider />
            <KV label="Expiring 30 / 60 / 90 days" value={`${p.leaseLifecycle.expiring30} / ${p.leaseLifecycle.expiring60} / ${p.leaseLifecycle.expiring90}`} />
            <KV label="Renewal backlog (expired)" value={p.leaseLifecycle.renewalBacklog} dot={p.leaseLifecycle.renewalBacklog > 0 ? 'var(--color-gold)' : undefined} />
            <Divider />
            <KV label="Annual rent managed" value={aed(p.financials.annualRentManaged)} />
            <KV label="Total contract value" value={aed(p.financials.totalContractValue)} />
            <KV label="Deposits held" value={aed(p.financials.depositsHeld)} />
          </MiniPanel>

          <MiniPanel title="Collections (across managed landlords)">
            <KV label="Cleared" value={`${p.collections.byStatus.cleared?.count ?? 0} · ${aed(p.collections.byStatus.cleared?.amount ?? 0)}`} dot="var(--color-primary)" />
            <KV label="Pending" value={`${p.collections.byStatus.pending?.count ?? 0} · ${aed(p.collections.byStatus.pending?.amount ?? 0)}`} dot="var(--color-gold)" />
            <KV label="Bounced" value={`${p.collections.byStatus.bounced?.count ?? 0} · ${aed(p.collections.byStatus.bounced?.amount ?? 0)}`} dot="var(--color-error)" />
            <KV label="Collection rate" value={`${p.collections.collectionRatePct}%`} />
            <Divider />
            <Caption>Lease status mix</Caption>
            {Object.entries(p.leaseLifecycle.byStatus).sort(byCountDesc).map(([k, v]) => <KV key={k} label={titleCase(k)} value={v} />)}
          </MiniPanel>
        </div>
      )}

      {/* Landlords worked for — each row expands to the exact grant, because
          "who let this manager clear cheques?" can't be answered by a badge. */}
      <Section title="Landlords worked for" count={m.landlords.length}>
        {m.landlords.map((l) => {
          const granted = allPerms.filter((p) => l.permissions?.[p.key]);
          const money = granted.filter((p) => p.money);
          const revoked = l.isActive === false;
          return (
            <div key={l.rentalProviderId} className="rounded-xl mb-2 last:mb-0" style={{ ...ROW_STYLE, opacity: revoked ? 0.6 : 1 }}>
              <Link href={l.userId ? `/dashboard/admin/users/${l.userId}` : '#'} className={`${ROW} transition-colors hover:brightness-95`} style={{ border: 'none' }}>
                <Building2 size={16} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate flex items-center gap-2" style={{ color: 'var(--color-neutral-900)' }}>
                    {l.companyName || l.ownerName || `RP #${l.rentalProviderId}`}
                    {revoked && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0"
                        style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>
                        Access revoked
                      </span>
                    )}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
                    {l.units} units · {l.activeLeases}/{l.leases} active leases · since {fmtDate(l.grantedAt)} ({fmtDuration(l.tenureDays)})
                    {l.grantedByRole ? ` · granted by ${titleCase(l.grantedByRole)}` : ''}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {l.badges.poa && <MiniBadge label="POA" />}
                  {l.badges.sign && <MiniBadge label="Sign" />}
                  {l.badges.money && <MiniBadge label="$" />}
                  {l.badges.contracts && <MiniBadge label="Contracts" />}
                </div>
                <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />
              </Link>
              {l.permissions && (
                <div className="px-3 pb-2.5 -mt-1">
                  <p className="text-[11px] mb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    {granted.length} of {totalPerms} permissions{money.length > 0 ? ` · ${money.length} money-related` : ''}
                    {revoked && ' · retained on record but no longer enforced'}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {granted.length === 0
                      ? <span className="text-[11px]" style={{ color: 'var(--color-neutral-400)' }}>No permissions granted.</span>
                      : granted.map((p) => (
                        <span key={p.key} className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={p.money
                            ? { backgroundColor: '#fef2f2', color: 'var(--color-error)' }
                            : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>
                          {p.label}
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Section>

      {/* Record parity with the landlord page (SCRUM-699). Everything above is an
          aggregate; these are the rows behind them. Scoped to landlords with a
          LIVE grant — a revoked grant is listed above but confers no access, so
          its records are not part of "what can this manager reach". */}
      {rec && (
        <>
          <p className="text-xs mt-6 mb-2 px-1" style={{ color: 'var(--color-neutral-400)' }}>
            The records below cover the {rec.scopedToLandlords} landlord{rec.scopedToLandlords === 1 ? '' : 's'} this
            manager currently holds an active grant for. Each row names its landlord.
          </p>

          <Section title="Buildings & units" count={rec.properties.length}>
            {rec.properties.map((p) => (
              <div key={p.id} className="rounded-xl mb-2 last:mb-0" style={ROW_STYLE}>
                <div className={ROW} style={{ border: 'none' }}>
                  <Building2 size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{p.buildingName || `Property #${p.id}`}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
                      {p.landlord ?? '—'} · {p.occupiedCount}/{p.unitCount} units occupied
                      {p.fullAddress ? ` · ${p.fullAddress}` : ''}
                    </p>
                  </div>
                  {p.spaceCategory && <Pill value={p.spaceCategory} />}
                </div>
                {(unitsByProp[p.id] ?? []).length > 0 && (
                  <div className="px-3 pb-2.5 -mt-1 flex flex-wrap gap-1">
                    {(unitsByProp[p.id] ?? []).map((un) => (
                      <span key={un.id} className="text-[11px] font-medium px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>
                        {un.unitNumber || `#${un.id}`}
                        {un.rentalPrice != null ? ` · ${aed(un.rentalPrice)}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Section>

          <Section title="Customers" count={rec.customers.length}>
            {rec.customers.map((t) => (
              <Link key={t.tenantId} href={`/dashboard/admin/users/${t.userId}`} className={`${ROW} transition-colors hover:brightness-95`} style={ROW_STYLE}>
                <UsersIcon size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{t.name}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{t.email ?? t.phone ?? '—'}{t.hasLease ? '' : ' · no lease yet'}</p>
                </div>
                <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />
              </Link>
            ))}
          </Section>

          <Section title="Leases" count={rec.leases.length}>
            {rec.leases.map((c) => (
              <div key={c.id} className={ROW} style={ROW_STYLE}>
                <FileText size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                    {c.tenantName}
                    {c.unitNumber && <span className="font-normal" style={{ color: 'var(--color-neutral-400)' }}> · Unit {c.unitNumber}</span>}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
                    {c.landlord ?? '—'} · {fmtDate(c.contractStartDate)} → {fmtDate(c.contractEndDate)} · {aed(c.annualRent)}/yr
                  </p>
                </div>
                <Pill value={c.status} />
              </div>
            ))}
          </Section>

          <Section title="Payments" count={rec.payments.length}>
            <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
              Most recent 200 rows across managed landlords. All payment types — the collection figures above cover rent only.
            </p>
            {rec.payments.map((p) => (
              <div key={p.id} className={ROW} style={ROW_STYLE}>
                <Banknote size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                    {p.customerName}
                    {p.unitNumber && <span className="font-normal" style={{ color: 'var(--color-neutral-400)' }}> · Unit {p.unitNumber}</span>}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
                    {p.landlord ?? '—'} · {titleCase(p.paymentType)} · {fmtDate(p.transactionDate)}
                    {p.chequeNumber ? ` · cheque ${p.chequeNumber}` : ''}
                  </p>
                </div>
                <span className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--color-neutral-900)' }}>{aed(p.amountPaid)}</span>
                <Pill value={p.chequeStatus} />
              </div>
            ))}
          </Section>

          <Section title="Landlord documents" count={rec.documents.length}>
            {rec.documents.map((d) => <DocRow key={d.id} d={d} sub={d.landlord ?? undefined} />)}
          </Section>

          {/* The rows behind "Attributed to this manager" above. */}
          <Section title="Recent activity" count={m.attributed.recent?.length ?? 0}>
            <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
              {m.attributed.auditActions} logged actions all time. Work done for a landlord is attributed here, not on their page.
            </p>
            {(m.attributed.recent ?? []).map((a, i) => (
              <div key={i} className={ROW} style={ROW_STYLE}>
                <Clock size={14} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{titleCase(a.actionKey)}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{titleCase(a.entityType)} #{a.entityId}</p>
                </div>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-neutral-400)' }}>{fmtDate(a.createdAt)}</span>
              </div>
            ))}
          </Section>
        </>
      )}
    </>
  );
}

/** Customer breakdown — tenancies, landlords, payment track record, KYC docs. */
function CustomerView({ c }: { c: NonNullable<UserDetail['customer']> }) {
  const s = c.summary, pay = c.payments, docs = c.documents;
  const docList = docs?.list ?? [];
  const p = c.profile, fin = c.financials;
  const isCompany = (p?.entityType ?? '').toLowerCase() === 'company';

  // Additional occupants have no table of their own — they exist as
  // occupant_<n>_* identity documents hanging off the customer, exactly as the
  // RP customer page derives them.
  const occupantDocs = docList.filter((d) => /^occupant_\d+_/.test(d.documentKey ?? ''));
  const occupants = [...new Set(occupantDocs.map((d) => Number(/^occupant_(\d+)_/.exec(d.documentKey)?.[1] ?? 0)))]
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
    .map((n) => ({ n, docs: occupantDocs.filter((d) => d.documentKey.startsWith(`occupant_${n}_`)) }));
  const primaryDocs = docList.filter((d) => !/^occupant_\d+_/.test(d.documentKey ?? ''));
  const leaseDocCount = (c.leaseDocuments ?? []).reduce((s, g) => s + g.documents.length, 0);
  const payData = pay ? [
    { name: 'Cleared', value: pay.byStatus.cleared?.amount ?? 0, fill: CHART.teal },
    { name: 'Pending', value: pay.byStatus.pending?.amount ?? 0, fill: CHART.amber },
    { name: 'Bounced', value: pay.byStatus.bounced?.amount ?? 0, fill: CHART.red },
  ] : [];
  const tStatus: Record<string, number> = {};
  c.leases.forEach((l) => { tStatus[l.status] = (tStatus[l.status] ?? 0) + 1; });
  const tData = Object.entries(tStatus).map(([k, v]) => ({ name: titleCase(k), value: v, fill: leaseStatusColor[k] ?? CHART.blue }));
  const docData = docs ? [
    { name: 'Verified', value: docs.verified, fill: CHART.teal },
    { name: 'Pending review', value: docs.pending, fill: CHART.amber },
    { name: 'Requested', value: docs.requested, fill: CHART.gray },
  ].filter((d) => d.value > 0) : [];
  return (
    <>
      {/* Identity & KYC particulars — the RP sees these on their own customer
          page; admin previously had only nationality on the header card. */}
      {p && (
        <div className="bg-white rounded-2xl p-4 mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <ProfileBit label="Renting as" value={isCompany ? 'Company' : 'Individual'} />
          {p.emiratesIdNumber && <ProfileBit label="Emirates ID" value={p.emiratesIdNumber} />}
          {p.nationality && <ProfileBit label="Nationality" value={p.nationality} />}
          {p.gender && <ProfileBit label="Gender" value={titleCase(p.gender)} />}
          {p.dateOfBirth && <ProfileBit label="Date of birth" value={`${fmtDate(p.dateOfBirth)}${ageFrom(p.dateOfBirth) != null ? ` · ${ageFrom(p.dateOfBirth)} yrs` : ''}`} />}
          {p.companyName && <ProfileBit label="Company" value={p.companyName} />}
          {p.tradeLicenseNumber && <ProfileBit label="Trade licence" value={p.tradeLicenseNumber} />}
          {p.tradeLicenseAuthority && <ProfileBit label="Licence authority" value={p.tradeLicenseAuthority} />}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <KpiCard label="Tenancies" value={s.leases} sub={`${s.activeLeases} active`} accent="var(--color-primary)" />
        <KpiCard label="Landlords" value={s.landlords} sub="rented from" />
        <KpiCard label="Annual rent (active)" value={aed(s.annualRentActive)} />
        <KpiCard label="Deposits held" value={aed(s.depositsHeld)} />
        <KpiCard label="Paid to date" value={pay ? aed(pay.paidAmount) : '—'} sub={pay ? `${aed(pay.pendingAmount)} pending` : ''} />
        <KpiCard label="Bounced cheques" value={pay?.bouncedCount ?? 0} accent={(pay?.bouncedCount ?? 0) > 0 ? 'var(--color-error)' : undefined} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <ChartCard title="Payments" sub="cheque amounts by status">
          {pay ? <CountBars data={payData} aedMode /> : <p className="text-sm py-8 text-center" style={{ color: 'var(--color-neutral-400)' }}>No payments yet.</p>}
        </ChartCard>
        <ChartCard title="Tenancy status" sub={`${s.leases} total · ${s.activeLeases} active`}>
          <Donut data={tData} center={String(s.activeLeases)} label="active" />
          <Legend items={tData} />
        </ChartCard>
        <ChartCard title="KYC documents" sub={docs ? `${docs.total} on file${docs.requested > 0 ? ` · ${docs.requested} requested` : ''}` : ''}>
          {docData.length > 0
            ? <><Donut data={docData} center={String(docs?.verified ?? 0)} label="verified" /><Legend items={docData} /></>
            : <p className="text-sm py-8 text-center" style={{ color: 'var(--color-neutral-400)' }}>No documents uploaded.</p>}
        </ChartCard>
      </div>

      {/* Rent money, same definitions the RP customer page uses. */}
      {fin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <MiniPanel title="Financial summary">
            <p className="text-xs mb-2" style={{ color: 'var(--color-neutral-400)' }}>
              Rent only — one-off fees (admin, registration, commission) are not counted as rent arrears.
            </p>
            <KV label="Total billed" value={aed(fin.totalBilled)} />
            <KV label="Collected" value={aed(fin.totalCollected)} dot="var(--color-primary)" />
            <KV label="Outstanding" value={aed(fin.totalOutstanding)} dot={fin.totalOutstanding > 0 ? 'var(--color-error)' : undefined} />
            <Divider />
            <KV label="VAT collected" value={aed(fin.vatCollected)} />
            <KV label="Security deposit held" value={aed(fin.securityDepositHeld)} />
            <KV label="Collection rate" value={fin.totalBilled > 0 ? `${Math.round((fin.totalCollected / fin.totalBilled) * 100)}%` : '—'} />
          </MiniPanel>

          <Section title="Notes journal" count={c.notes?.length ?? 0}>
            <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
              The running operational log the landlord keeps across every tenancy.
            </p>
            {(c.notes ?? []).map((n) => (
              <div key={n.id} className="rounded-xl px-3 py-2" style={ROW_STYLE}>
                <p className="text-sm" style={{ color: 'var(--color-neutral-800)' }}>{n.body}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-neutral-400)' }}>
                  {n.authorName ?? 'Unknown'}{n.authorRole ? ` · ${titleCase(n.authorRole)}` : ''}
                  {n.unitNumber ? ` · Unit ${n.unitNumber}` : ''} · {fmtDate(n.createdAt)}
                </p>
              </div>
            ))}
          </Section>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Tenancies" count={c.leases.length}>
          {c.leases.map((l) => {
            const inner = (
              <>
                <FileText size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                    {l.companyName || '—'}{l.unitNumber && <span className="font-normal" style={{ color: 'var(--color-neutral-400)' }}> · Unit {l.unitNumber}</span>}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                    {fmtDate(l.contractStartDate)} → {fmtDate(l.contractEndDate)} · {aed(l.annualRent)}/yr
                    {(l.discountAmount ?? 0) > 0 && l.listedRent != null && (
                      <span style={{ color: 'var(--color-gold)' }}> · {aed(l.discountAmount)} off {aed(l.listedRent)}</span>
                    )}
                  </p>
                  {/* Deposit is only shown when this lease itself carries one —
                      on a renewal chain it sits on the root lease, so printing a
                      hard "AED 0" on every child would read as "no deposit" when
                      the summary above correctly shows one is held. */}
                  <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                    {l.securityDeposit > 0 && <>Deposit {aed(l.securityDeposit)} · </>}
                    collected {aed(l.collected)}
                    {l.outstanding > 0 && <span style={{ color: 'var(--color-error)' }}> · {aed(l.outstanding)} outstanding</span>}
                    {l.ejariStatus && <span> · registration {titleCase(l.ejariStatus)}</span>}
                  </p>
                </div>
                <Pill value={l.status} />
                {l.unitId != null && <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />}
              </>
            );
            return l.unitId != null ? (
              <Link key={l.id} href={`/dashboard/admin/units/${l.unitId}`} className={`${ROW} transition-colors hover:brightness-95`} style={ROW_STYLE}>{inner}</Link>
            ) : (
              <div key={l.id} className={ROW} style={ROW_STYLE}>{inner}</div>
            );
          })}
        </Section>

        <Section title="Landlords" count={c.landlords.length}>
          {c.landlords.map((l) => (
            <Link key={l.rentalProviderId} href={l.userId ? `/dashboard/admin/users/${l.userId}` : '#'} className={`${ROW} transition-colors hover:brightness-95`} style={ROW_STYLE}>
              <Building2 size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{l.companyName || l.ownerName || `RP #${l.rentalProviderId}`}</p>
                <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{l.leases} lease{l.leases === 1 ? '' : 's'}</p>
              </div>
              <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />
            </Link>
          ))}
        </Section>

        {/* KYC documents — the rows behind the counts chart above. Read-only:
            verify / reject stays in the KYC Verification Center. */}
        <Section title={isCompany ? 'Company KYC documents' : 'KYC documents'} count={primaryDocs.length}>
          {primaryDocs.map((d) => <DocRow key={d.id} d={d} />)}
        </Section>

        {/* Lease paperwork, grouped per tenancy. These documents belong to the
            CONTRACT, not the customer, so the customer-scoped list above never
            included them — the signed agreement, registration certificate,
            invoices and receipts all live here. */}
        <Section title="Lease documents" count={leaseDocCount}>
          {(c.leaseDocuments ?? []).map((g) => {
            // A renewal chain puts every lease on the same unit, so the unit
            // number alone can't tell two tenancies apart — carry the term.
            const lease = c.leases.find((l) => l.id === g.leaseId);
            return (
            <div key={g.leaseId} className="rounded-xl px-3 py-2.5 mb-2 last:mb-0" style={ROW_STYLE}>
              <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-neutral-900)' }}>
                {g.unitNumber ? `Unit ${g.unitNumber}` : `Lease #${g.leaseId}`}
                <span className="font-normal ml-1.5" style={{ color: 'var(--color-neutral-400)' }}>
                  {g.documents.length} document{g.documents.length === 1 ? '' : 's'}
                </span>
              </p>
              <p className="text-xs mb-1.5" style={{ color: 'var(--color-neutral-500)' }}>
                {lease
                  ? <>{fmtDate(lease.contractStartDate)} → {fmtDate(lease.contractEndDate)} · {titleCase(lease.status)}</>
                  : `Lease #${g.leaseId}`}
              </p>
              <div className="space-y-1.5">
                {g.documents.map((d) => <DocRow key={d.id} d={d} />)}
              </div>
            </div>
            );
          })}
        </Section>

        {/* Additional occupants — people living with the primary customer. They
            have no table of their own; they exist as occupant_<n>_* identity
            documents, which is how the RP page derives them too. */}
        <Section title="Additional occupants" count={occupants.length}>
          {occupants.map((o) => (
            <div key={o.n} className="rounded-xl px-3 py-2.5" style={ROW_STYLE}>
              <p className="text-sm font-semibold mb-1.5" style={{ color: 'var(--color-neutral-900)' }}>
                Occupant {o.n}
                <span className="font-normal ml-1.5" style={{ color: 'var(--color-neutral-400)' }}>
                  {o.docs.length} document{o.docs.length === 1 ? '' : 's'}
                </span>
              </p>
              <div className="space-y-1.5">
                {o.docs.map((d) => <DocRow key={d.id} d={d} />)}
              </div>
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}

/** Staff (admin / super-admin) breakdown — platform activity from the audit log. */
function StaffView({ s, role }: { s: NonNullable<UserDetail['staff']>; role: string }) {
  const actionData = Object.entries(s.actionsByKey).sort(byCountDesc).map(([k, v]) => ({ name: titleCase(k), value: v }));
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Total actions" value={s.summary.totalActions} sub="logged on platform" accent="var(--color-primary)" />
        <KpiCard label="Last 30 days" value={s.summary.last30dActions} />
        <KpiCard label="Entities touched" value={s.summary.distinctEntities} />
        <KpiCard label="Last action" value={s.summary.lastActionAt ? fmtDate(s.summary.lastActionAt) : '—'} />
      </div>

      {s.summary.totalActions === 0 ? (
        <p className="text-sm bg-white rounded-2xl p-4" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>
          No logged platform activity for this {roleLabel[role] ?? role} account yet. Note: manager and some staff actions are still recorded under the landlord rather than the individual.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Actions by type" sub="platform actions, all time">
            <ResponsiveContainer width="100%" height={Math.max(140, actionData.length * 34)}>
              <BarChart layout="vertical" data={actionData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10, fill: '#6b6860' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: unknown) => [String(v), 'Actions'] as [string, string]} contentStyle={tooltipStyle} cursor={{ fill: '#fafaf8' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={CHART.purple} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <Section title="Recent activity" count={s.recentActions.length}>
            {s.recentActions.map((a, i) => (
              <div key={i} className={ROW} style={ROW_STYLE}>
                <Clock size={14} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{titleCase(a.actionKey)}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{titleCase(a.entityType)} #{a.entityId}</p>
                </div>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-neutral-400)' }}>{fmtDate(a.createdAt)}</span>
              </div>
            ))}
          </Section>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Service-provider view — SP-side breakdown for the admin audit
───────────────────────────────────────────────────────────── */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const listingStatusColor: Record<string, string> = { approved: CHART.teal, pending: CHART.amber, rejected: CHART.red };
const PRICE_UNIT_SUFFIX: Record<string, string> = {
  fixed: '', per_hour: '/hr', per_unit: '/unit', per_area: '/m²',
  per_size_package: '', per_period: '/period', quote_after_callout: '',
};
const spComplianceTier: Record<string, { label: string; bg: string; fg: string; accent: string }> = {
  compliant: { label: 'Compliant', bg: 'var(--color-primary-50)', fg: 'var(--color-primary)', accent: 'var(--color-primary)' },
  pending_review: { label: 'Pending review', bg: '#eff6ff', fg: '#1e40af', accent: '#2563eb' },
  action_required: { label: 'Action required', bg: '#fef2f2', fg: '#dc2626', accent: '#dc2626' },
  expired: { label: 'Expired', bg: '#fef2f2', fg: '#dc2626', accent: '#dc2626' },
  paused: { label: 'Paused', bg: 'var(--color-base-100)', fg: 'var(--color-neutral-600)', accent: 'var(--color-neutral-400)' },
};

/** Formats a catalogue item's price for display: "Quote" or "AED X/unit". */
function svcPrice(c: NonNullable<UserDetail['sp']>['catalog'][number]): string {
  if (c.pricingMode === 'quote' || c.priceUnit === 'quote_after_callout') return 'Quote after callout';
  if (c.basePrice == null) return '—';
  return `${aed(c.basePrice)}${PRICE_UNIT_SUFFIX[c.priceUnit] ?? ''}`;
}

/** Readiness & compliance — surfaced first, mirrors the manager RiskPanel weight. */
function ReadinessPanel({ r }: { r: NonNullable<NonNullable<UserDetail['sp']>['readiness']> }) {
  const t = spComplianceTier[r.complianceStatus] ?? spComplianceTier.pending_review;
  return (
    <div className="bg-white rounded-2xl p-4 mb-4" style={{ boxShadow: 'var(--shadow-sm)', borderLeft: `3px solid ${r.jobReady ? 'var(--color-primary)' : t.accent}` }}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {r.jobReady ? <CheckCircle2 size={16} style={{ color: 'var(--color-primary)' }} /> : <ShieldAlert size={16} style={{ color: t.accent }} />}
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>Readiness &amp; compliance</h3>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: t.bg, color: t.fg }}>{t.label}</span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1" style={r.jobReady ? { backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' } : { backgroundColor: '#fef9eb', color: 'var(--color-gold)' }}>
          {r.jobReady ? <><CheckCircle2 size={11} /> Job-ready</> : <><Clock size={11} /> Not job-ready</>}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
        <ProfileBit label="Job-ready since" value={r.jobReadyAt ? fmtDate(r.jobReadyAt) : 'Not yet'} />
        <ProfileBit label="Rules accepted" value={r.jobRulesAcceptedAt ? fmtDate(r.jobRulesAcceptedAt) : 'No'} />
        <ProfileBit label="Max concurrent jobs" value={r.maxConcurrentJobs != null ? String(r.maxConcurrentJobs) : 'Auto'} />
        <ProfileBit label="Min notice" value={r.minNoticeHours != null ? `${r.minNoticeHours}h` : '—'} />
        {r.teamSizeBand && <ProfileBit label="Team band" value={r.teamSizeBand} />}
        {r.fleetSizeBand && <ProfileBit label="Fleet band" value={r.fleetSizeBand} />}
        {r.compliancePausedAt && <ProfileBit label="Paused at" value={fmtDate(r.compliancePausedAt)} />}
      </div>
      {r.complianceNotes && (
        <p className="text-xs mt-2 pt-2" style={{ color: 'var(--color-neutral-500)', borderTop: '1px solid var(--color-base-200)' }}>{r.complianceNotes}</p>
      )}
    </div>
  );
}

function SpView({ sp }: { sp: NonNullable<UserDetail['sp']> }) {
  const { profile: p, readiness, summary: s, insights: ins } = sp;
  const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1];

  const catalogData = ins ? [
    { name: 'Approved', value: ins.catalog.byStatus.approved ?? 0, fill: CHART.teal },
    { name: 'Pending', value: ins.catalog.byStatus.pending ?? 0, fill: CHART.amber },
    { name: 'Rejected', value: ins.catalog.byStatus.rejected ?? 0, fill: CHART.red },
  ] : [];
  const serviceMixData = ins ? Object.entries(ins.serviceMix).sort(byCount).map(([k, v]) => ({ name: titleCase(k), value: v, fill: CHART.blue })) : [];
  const ratingData = ins ? [5, 4, 3, 2, 1].map((star) => ({
    name: `${star}★`,
    value: ins.reviews.distribution[String(star)] ?? 0,
    fill: star >= 4 ? CHART.teal : star === 3 ? CHART.amber : CHART.red,
  })) : [];

  // Catalogue grouped by service category — segregated list rather than a flat
  // mix. Each group keeps insertion order (backend already sorts by category, name).
  type SpCatalogItem = NonNullable<UserDetail['sp']>['catalog'][number];
  const catGroups: { category: string; items: SpCatalogItem[]; approved: number; available: number }[] =
    Object.values(
      sp.catalog.reduce((acc, c) => {
        const g = (acc[c.category] ??= { category: c.category, items: [], approved: 0, available: 0 });
        g.items.push(c);
        if (c.listingStatus === 'approved') g.approved++;
        if (c.isAvailable) g.available++;
        return acc;
      }, {} as Record<string, { category: string; items: SpCatalogItem[]; approved: number; available: number }>),
    ).sort((a, b) => b.items.length - a.items.length);

  return (
    <>
      {/* Profile line */}
      {p && (
        <div className="bg-white rounded-2xl p-4 mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm items-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
          {(p.businessName || p.companyName) && <ProfileBit label="Business" value={p.businessName || p.companyName || '—'} />}
          {p.ownerName && <ProfileBit label="Owner" value={p.ownerName} />}
          <ProfileBit label="Type" value={titleCase(p.entityType)} />
          {p.tradeLicenseNumber && <ProfileBit label="Trade License" value={p.tradeLicenseNumber} />}
          {p.vatTrn && <ProfileBit label="VAT TRN" value={p.vatTrn} />}
          {p.emiratesServed.length > 0 && <ProfileBit label="Emirates" value={p.emiratesServed.map(titleCase).join(', ')} />}
          {p.emergencyResponse && <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fff7ed', color: '#c2410c' }}><Zap size={11} /> Emergency response</span>}
          {p.isGovernment && <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#eff6ff', color: '#1e40af' }}>Government</span>}
        </div>
      )}

      {/* Readiness & compliance — surfaced first */}
      {readiness && <ReadinessPanel r={readiness} />}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <KpiCard label="Services listed" value={`${s.servicesApproved}/${s.services}`} sub="approved / total" accent="var(--color-primary)" />
        <KpiCard label="Field team" value={s.technicians} sub={`${s.leadTechnicians} lead-capable`} />
        <KpiCard label="Fleet" value={s.activeVehicles} sub={`of ${s.vehicles} vehicle${s.vehicles === 1 ? '' : 's'}`} />
        <KpiCard label="Coverage" value={s.coverageZones} sub={`${s.emiratesServed} emirate${s.emiratesServed === 1 ? '' : 's'} · zones`} />
        <KpiCard label="Rating" value={s.avgRating ? s.avgRating.toFixed(1) : '—'} sub={`${s.totalReviews} review${s.totalReviews === 1 ? '' : 's'}`} accent={s.avgRating >= 4 ? 'var(--color-primary)' : s.avgRating > 0 && s.avgRating < 3 ? 'var(--color-error)' : undefined} />
        <KpiCard label="Jobs completed" value={s.completedBookings} sub={`${s.bookings} booking${s.bookings === 1 ? '' : 's'} total`} />
      </div>

      {/* Charts — SP at a glance */}
      {ins && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <ChartCard title="Catalogue moderation" sub={`${ins.catalog.total} services · ${ins.catalog.available} available`}>
            <Donut data={catalogData} center={`${ins.catalog.total}`} label="services" />
            <Legend items={catalogData} />
          </ChartCard>
          <ChartCard title="Service mix" sub="listings by category">
            {serviceMixData.length ? <CountBars data={serviceMixData} /> : <p className="text-sm py-12 text-center" style={{ color: 'var(--color-neutral-400)' }}>No services listed yet.</p>}
          </ChartCard>
          <ChartCard title="Rating distribution" sub={`${ins.reviews.totalReviews} reviews`}>
            {ins.reviews.totalReviews > 0 ? <CountBars data={ratingData} /> : <p className="text-sm py-12 text-center" style={{ color: 'var(--color-neutral-400)' }}>No reviews yet.</p>}
          </ChartCard>
        </div>
      )}

      {/* Detail panels */}
      {ins && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <MiniPanel title="Catalogue & operations">
            <KV label="Services available" value={`${ins.catalog.available}/${ins.catalog.total}`} dot="var(--color-primary)" />
            <KV label="Approved" value={ins.catalog.byStatus.approved ?? 0} dot={CHART.teal} />
            <KV label="Pending review" value={ins.catalog.byStatus.pending ?? 0} dot={CHART.amber} />
            <KV label="Rejected" value={ins.catalog.byStatus.rejected ?? 0} dot={CHART.red} />
            <Divider />
            <Caption>Booking track-record</Caption>
            <KV label="Completed" value={ins.bookings.completed} />
            <KV label="Revenue (completed)" value={aed(ins.bookings.revenue)} />
            <KV label="Cancelled" value={ins.bookings.cancelled} />
            {ins.bookings.total === 0 && <p className="text-[11px]" style={{ color: 'var(--color-neutral-400)' }}>No bookings dispatched to this provider yet.</p>}
          </MiniPanel>

          <MiniPanel title="Coverage & availability">
            <Caption>Emirates served</Caption>
            {p && p.emiratesServed.length > 0
              ? <p className="text-sm" style={{ color: 'var(--color-neutral-800)' }}>{p.emiratesServed.map(titleCase).join(', ')}</p>
              : <p className="text-sm" style={{ color: 'var(--color-neutral-400)' }}>No emirates set.</p>}
            <KV label="Coverage zones" value={s.coverageZones} />
            <Divider />
            <Caption>Service categories</Caption>
            {p && p.serviceCategories.length > 0
              ? <div className="flex flex-wrap gap-1.5">{p.serviceCategories.map((c) => <span key={c} className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>{titleCase(c)}</span>)}</div>
              : <p className="text-sm" style={{ color: 'var(--color-neutral-400)' }}>None set.</p>}
            <Divider />
            <KV label="Weekly availability" value={`${ins.availability.daysCovered}/7 days · ${ins.availability.shifts} shift${ins.availability.shifts === 1 ? '' : 's'}`} />
          </MiniPanel>
        </div>
      )}

      {/* Breakdown — two per row, each scrolls internally */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Service catalogue — segregated by category, services nested per group */}
        <Section title="Service catalogue" count={sp.catalog.length}>
          {catGroups.map((g) => (
            <div key={g.category} className="mb-3">
              {/* Category header */}
              <div className="flex items-center gap-2 px-1 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-neutral-500)' }}>{titleCase(g.category)}</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>{g.items.length}</span>
                <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-neutral-400)' }}>{g.approved} approved · {g.available} available</span>
              </div>
              {/* Services in this category */}
              <div className="space-y-1">
                {g.items.map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl" style={ROW_STYLE}>
                    <Wrench size={14} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                        {c.name}
                        {c.isEmergency && <Zap size={11} className="inline ml-1" style={{ color: '#c2410c' }} />}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{svcPrice(c)}</p>
                    </div>
                    {!c.isAvailable && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>Hidden</span>}
                    <Pill value={c.listingStatus} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Section>

        {/* Field team — technicians */}
        <Section title="Field team" count={sp.technicians.length}>
          {sp.technicians.map((t) => (
            <div key={t.id} className={`${ROW} ${t.userId ? 'cursor-pointer transition-colors hover:brightness-95' : ''}`} style={ROW_STYLE} onClick={t.userId ? () => { window.location.href = `/dashboard/admin/users/${t.userId}`; } : undefined}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: 'var(--color-base-100)' }}>
                {t.photoUrl ? <img src={t.photoUrl} alt="" className="w-full h-full object-cover" /> : <UserCog size={14} style={{ color: 'var(--color-neutral-500)' }} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                  {t.name}
                  {t.isLeadCapable && <MiniBadge label="LEAD" />}
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{t.specialization || t.email || '—'}</p>
              </div>
              {t.complianceStatus && <Pill value={t.complianceStatus} />}
            </div>
          ))}
        </Section>

        {/* Fleet */}
        <Section title="Fleet" count={sp.vehicles.length}>
          {sp.vehicles.map((v) => (
            <div key={v.id} className={ROW} style={ROW_STYLE}>
              <Truck size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{v.label || titleCase(v.vehicleType)}</p>
                <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{titleCase(v.vehicleType)}</p>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={v.isActive ? { backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' } : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>{v.isActive ? 'Active' : 'Inactive'}</span>
            </div>
          ))}
        </Section>

        {/* Coverage zones */}
        <Section title="Coverage zones" count={sp.coverageZones.length}>
          {sp.coverageZones.map((z) => (
            <div key={z.id} className={ROW} style={ROW_STYLE}>
              <MapPin size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{z.nameEn}</p>
                {z.nameAr && <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }} dir="rtl">{z.nameAr}</p>}
              </div>
              {!z.isActive && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>Inactive</span>}
            </div>
          ))}
        </Section>

        {/* Working hours */}
        <Section title="Working hours" count={sp.workingHours.length}>
          {sp.workingHours.map((h, i) => (
            <div key={i} className={ROW} style={ROW_STYLE}>
              <CalendarClock size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
              <span className="font-semibold text-sm flex-1" style={{ color: 'var(--color-neutral-900)' }}>{WEEKDAYS[h.weekday] ?? `Day ${h.weekday}`}</span>
              <span className="text-sm" style={{ color: 'var(--color-neutral-600)' }}>{(h.opensAt || '').slice(0, 5)} – {(h.closesAt || '').slice(0, 5)}</span>
            </div>
          ))}
        </Section>

        {/* Reviews */}
        <Section title="Reviews" count={sp.reviews.length}>
          {sp.reviews.map((rv) => (
            <div key={rv.id} className={ROW} style={ROW_STYLE}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-0.5 flex-shrink-0" style={{ color: 'var(--color-gold)' }}>
                    {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={11} fill={i < rv.rating ? 'currentColor' : 'none'} style={{ color: i < rv.rating ? 'var(--color-gold)' : 'var(--color-neutral-300)' }} />)}
                  </span>
                  <span className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{rv.title || rv.reviewerName}</span>
                </div>
                {rv.body && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--color-neutral-500)' }}>{rv.body}</p>}
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-neutral-400)' }}>{rv.reviewerName} · {fmtDate(rv.createdAt)}</p>
              </div>
            </div>
          ))}
        </Section>

        {/* Bookings */}
        <Section title="Bookings" count={sp.bookings.length}>
          {sp.bookings.map((b) => (
            <div key={b.id} className={ROW} style={ROW_STYLE}>
              <FileText size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{b.serviceName || 'Service booking'}</p>
                <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{b.customerName} · {fmtDate(b.scheduledAt)}{b.totalAmount != null ? ` · ${aed(b.totalAmount)}` : ''}</p>
              </div>
              <Pill value={b.status} />
            </div>
          ))}
        </Section>

        {/* SP-owned documents */}
        <Section title="Documents" count={sp.documents.length}>
          {sp.documents.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--color-neutral-400)' }}>No documents on file for this service provider.</p>
          ) : sp.documents.map((d) => <DocRow key={d.id} d={d} />)}
        </Section>
      </div>
    </>
  );
}

export default function AdminUserDetailPage() {
  useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      setData(await apiGet<UserDetail>(`/admin/users/${id}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Suspend / reactivate without going back to the list. Ban is retired — the
  // status it wrote was never checked at login, so it locked nobody out.
  const changeStatus = useCallback(async (next: string) => {
    const target = data?.user;
    if (!target) return;
    setStatusBusy(true);
    try {
      await apiPatch(`/admin/users/${target.id}/status`, { status: next });
      setData((prev) => prev ? { ...prev, user: { ...prev.user, status: next } } : prev);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setStatusBusy(false);
    }
  }, [data?.user]);

  const u = data?.user;
  const L = data?.landlord;

  // Only the rules this landlord actually configured. Anything left at its
  // default is dropped rather than rendered as "not set" — the page shows data,
  // not an empty settings form.
  const prefs = L?.settings?.preferences;
  const setPrefs: [string, string][] = [];
  // "VAT collection mode", not "VAT on rent" — the fee schedule above now shows the
  // rent_vat RATE under that name, and two rows reading "VAT on rent" with different
  // values (0% vs Annual) is unreadable. Rate and collection mode are both needed.
  if (prefs?.rentVatMode) setPrefs.push(['VAT collection mode', titleCase(prefs.rentVatMode)]);
  if (prefs?.allowedInstallments?.length) setPrefs.push(['Installment plans', `${prefs.allowedInstallments.join(', ')} cheques`]);
  if (prefs?.startDays?.length) setPrefs.push(['Contract start days', prefs.startDays.join(', ')]);
  if (prefs?.chequeDays?.length) setPrefs.push(['Cheque due days', prefs.chequeDays.join(', ')]);
  if (prefs?.renewalRentIncrementPct != null) setPrefs.push(['Annual rent increment', `${prefs.renewalRentIncrementPct}%`]);

  const setPenalties: [string, string][] = PENALTY_LABELS
    .map(([key, label]) => [label, penaltyValue(L?.settings?.penalties?.[key])] as [string, string | null])
    .filter((e): e is [string, string] => e[1] != null);

  // Fee schedule grouped by space category (SCRUM-694). A landlord charges
  // different fees for residential vs commercial stock, so a flat list would be
  // ambiguous about which rule produced a given charge.
  const feeByCategory = (L?.settings?.feeSchedule ?? []).reduce<Record<string, FeeRuleRow[]>>(
    (acc, f) => {
      const key = f.spaceCategory ?? 'Uncategorised';
      (acc[key] ??= []).push(f);
      return acc;
    },
    {},
  );

  // Payments hang off the lease that produced them rather than standing as their
  // own section — a cheque only means anything next to its tenancy. Same nesting
  // the Buildings & units section uses for units under their property.
  const paymentsByLease = (L?.payments ?? []).reduce<Record<number, NonNullable<UserDetail['landlord']>['payments']>>(
    (acc, p) => {
      if (p.contractId == null) return acc;
      (acc[p.contractId] ??= []).push(p);
      return acc;
    },
    {},
  );
  // Rows the API returned that no lease on this page claims — a payment whose
  // contract_id is null. Counted so the total is never silently short.
  const unlinkedPayments = (L?.payments ?? []).filter((p) => p.contractId == null).length;

  /**
   * The customer roster is LIFETIME — everyone who has ever rented here, plus
   * converted leads. Split into who is renting now and who has gone, because a
   * single "Customers 116" next to the landlord's own directory reading 93 looks
   * like the two pages disagree when they are simply answering different
   * questions. `renting` is the backend's two-tier live-lease rule, identical to
   * the one the RP directory uses, so the halves match that page customer for
   * customer (RP 2: 93 renting / 21 ended / 2 never signed).
   */
  const allCustomers = L?.customers ?? [];
  const rentingCustomers = allCustomers.filter((c) => c.renting);
  // Had a lease, none live now. Kept apart from the never-signed leads below —
  // a former tenant and a lead who never converted are not the same record.
  const endedCustomers = allCustomers.filter((c) => !c.renting && c.hasLease);
  const leadOnlyCustomers = allCustomers.filter((c) => !c.renting && !c.hasLease);

  /**
   * Leases segregated by where each one is in its life. The list is the landlord's
   * whole history — 369 rows on RP 2 — and a status chip alone cannot separate a
   * running tenancy from one that ended two years ago, least of all the six rows
   * that still read `active` after their termination took effect.
   *
   * `phase` is computed backend-side from the same predicate the money figures
   * use, so these buckets and the rent totals never disagree.
   */
  const allLeases = L?.leases ?? [];
  const currentLeases = allLeases.filter((l) => (l.phase ?? 'current') === 'current');
  const awaitingLeases = allLeases.filter((l) => l.phase === 'awaiting');
  const endedLeases = allLeases.filter((l) => l.phase === 'ended');

  // POA paperwork gets its own panel, so it comes OUT of the general document
  // list rather than appearing in both. Same `poa_*` rule as the admin KYC page.
  const isPoaDoc = (k: string | null | undefined) => (k ?? '').startsWith('poa_');
  const poaDocs = (L?.documents ?? []).filter((d) => isPoaDoc(d.documentKey));
  const rpDocs = (L?.documents ?? []).filter((d) => !isPoaDoc(d.documentKey));
  // Rendered whenever there is anything to say about a POA — declared, a holder
  // named, or paperwork on file. A landlord with none of the three has no POA and
  // gets no panel.
  const showPoa = !!L && (L.profile.hasPoa === true || poaDocs.length > 0 || !!L.profile.poaPersonName);

  const caps = L?.settings?.settlementDiscountCaps;
  const setCaps: [string, string][] = ([
    ['Rent', caps?.rentPct], ['Penalties', caps?.penaltiesPct],
    ['Restoration', caps?.restorationPct], ['Utilities', caps?.utilitiesPct],
  ] as [string, number | null | undefined][])
    .filter((e): e is [string, number] => e[1] != null)
    .map(([label, v]) => [label, `${v}%`]);

  const M = data?.manager;
  const C = data?.customer;
  const S = data?.staff;
  const SP = data?.sp;

  return (
    <DashboardPage title="User Detail" subtitle={u ? u.name : ''}>
      <button
        onClick={() => router.push('/dashboard/admin/users')}
        className="flex items-center gap-1.5 text-sm mb-4 transition-colors"
        style={{ color: 'var(--color-neutral-500)' }}
      >
        <ArrowLeft size={15} /> Back to users
      </button>

      {loading && (
        <div className="rounded-2xl p-8 bg-white text-center text-sm" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>Loading…</div>
      )}
      {!loading && error && (
        <div className="rounded-2xl p-8 bg-white text-center text-sm" style={{ color: 'var(--color-error)', boxShadow: 'var(--shadow-sm)' }}>{error}</div>
      )}

      {!loading && !error && u && (
        <>
          {/* ── Summary ── */}
          <div className="bg-white rounded-2xl p-5 mb-6 flex flex-wrap items-center gap-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: 'var(--color-base-100)' }}>
              {u.profilePictureUrl
                ? <img src={u.profilePictureUrl} alt="" className="w-full h-full object-cover" />
                : <UsersIcon size={22} style={{ color: 'var(--color-neutral-500)' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold" style={{ color: 'var(--color-neutral-900)' }}>{u.name}</h2>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>{roleLabel[u.role] ?? u.role}</span>
                <Pill value={u.status} />
                {u.kycStatus === 'pending_review' && (
                  <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: '#fef9eb', color: 'var(--color-gold)' }}><ShieldCheck size={11} /> KYC Pending</span>
                )}
                {u.kycStatus === 'verified' && (
                  <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }}><BadgeCheck size={11} /> KYC Verified</span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1.5 text-sm flex-wrap" style={{ color: 'var(--color-neutral-500)' }}>
                <span className="flex items-center gap-1"><Mail size={13} /> {u.email}{u.emailVerified ? ' ✓' : ''}</span>
                {u.phone && <span className="flex items-center gap-1"><Phone size={13} /> {u.phone}{u.phoneVerified ? ' ✓' : ''}</span>}
                {u.nationality && <span>{u.nationality}</span>}
                <span className="flex items-center gap-1"><Clock size={13} /> Joined {fmtDate(u.createdAt)}</span>
              </div>
            </div>

            {/* Account actions — super admins are never suspendable */}
            {u.role !== 'super_admin' && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {u.status !== 'suspended' && (
                  <button
                    onClick={() => void changeStatus('suspended')}
                    disabled={statusBusy}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: '#fef2f2', color: 'var(--color-error)' }}
                    title="Block this user from signing in"
                  >
                    <UserX size={13} /> Suspend
                  </button>
                )}
                {(u.status === 'suspended' || u.status === 'banned') && (
                  <button
                    onClick={() => void changeStatus('active')}
                    disabled={statusBusy}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }}
                  >
                    <UserCheck size={13} /> Reactivate
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Role-specific breakdown ── */}
          {L && (
            <>
              {/* ── Headline ──
                  The three money figures lead, then a jump nav, then numbered
                  sections — the same shape as the admin Pulse dashboard. This
                  page previously ran fifteen shadowed cards end to end with no
                  category boundary, so nothing told the reader what any group of
                  cards was FOR. Each section now states the question it answers.
                  The detail order inside them is unchanged: Properties → Units →
                  Customers → Leases → Payments. */}
              <MoneyKpis ins={L.insights} />

              <nav className="flex gap-2 flex-wrap mt-4">
                {([
                  ['#sec-profile', '1 · Profile'],
                  ['#sec-portfolio', '2 · Portfolio'],
                  ['#sec-tenancies', '3 · Tenancies'],
                  ['#sec-money', '4 · Money'],
                  ['#sec-demand', '5 · Demand'],
                  ['#sec-governance', '6 · Governance'],
                  ['#sec-activity', '7 · Activity'],
                ] as [string, string][]).map(([href, label]) => (
                  <a key={href} href={href} className="text-[11px] text-[#6b6860] border border-[#e8e6e0] bg-white rounded-full px-3 py-1 hover:border-[#1e5fae] hover:text-[#1a1916]">{label}</a>
                ))}
              </nav>

              {/* ── 1 · PROFILE ── everything describing the LANDLORD rather than
                  their portfolio: identity, own paperwork, and the Power of
                  Attorney that lets somebody else act for them. */}
              <SectionHead id="sec-profile" no="Section 1 · Profile" q="Who is this landlord?" />
              <div className="flex flex-col gap-4">
                <div className={CARD}>
                  <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-neutral-900)' }}>Profile</h3>
                  <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                    {L.profile.companyName && <ProfileBit label="Company" value={L.profile.companyName} />}
                    <ProfileBit label="Type" value={titleCase(L.profile.companyType ?? L.profile.entityType)} />
                    {L.profile.tradeLicenseNumber && <ProfileBit label="Trade License" value={L.profile.tradeLicenseNumber} />}
                    <ProfileBit label="Provider ID" value={`#${L.profile.rentalProviderId}`} />
                  </div>
                </div>

                {/* RP-owned documents — inline view-only; empty file_url = requested/missing.
                    POA paperwork is excluded here and presented in its own panel below. */}
                <Section title="Rental Provider Documents" count={rpDocs.length}>
                  {rpDocs.length === 0 ? (
                    <p className="text-sm py-6 text-center" style={{ color: 'var(--color-neutral-400)' }}>No documents on file for this rental provider.</p>
                  ) : rpDocs.map((d) => <DocRow key={d.id} d={d} />)}
                </Section>
                {showPoa && <PoaPanel profile={L.profile} docs={poaDocs} />}
              </div>

              {/* ── 2 · PORTFOLIO ── */}
              <SectionHead id="sec-portfolio" no="Section 2 · Portfolio" q="What do they own?" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <OccupancyCard ins={L.insights} />
                <ListingsPanel ins={L.insights} />
              </div>
              {/* Properties | Units side by side — the two halves of the same
                  question, and each card scrolls internally so the pair stays the
                  height of one. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Properties. Units are no longer nested here — they are their
                    own card beside this one, so each step of the hierarchy is
                    readable on its own. */}
                <Section title="Properties" count={L.properties.length}>
                  {L.properties.map((p) => (
                    <Link key={p.id} href={`/dashboard/admin/properties/${p.id}`} className={`${ROW} transition-colors hover:brightness-95`} style={ROW_STYLE}>
                      <Building2 size={16} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{p.buildingName}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{p.fullAddress ?? '—'}</p>
                      </div>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>{titleCase(p.spaceCategory)}</span>
                      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-neutral-500)' }}>{p.occupiedCount}/{p.unitCount} occupied</span>
                      <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />
                    </Link>
                  ))}
                </Section>
                {/* Units — flat, each naming its property so the card stands on
                    its own now that it is not nested under one. */}
                <Section title="Units" count={L.units.length}>
                  {L.units.map((un) => (
                    <Link key={un.id} href={`/dashboard/admin/units/${un.id}`} className={`${ROW} transition-colors hover:brightness-95`} style={ROW_STYLE}>
                      <Home size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                          {un.unitNumber ? `Unit ${un.unitNumber}` : `Unit #${un.id}`}
                          {un.unitName && <span className="font-normal" style={{ color: 'var(--color-neutral-400)' }}> · {un.unitName}</span>}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
                          {un.propertyName ?? '—'} · {titleCase(un.unitType)}
                          {un.rentalPrice != null ? ` · ${aed(un.rentalPrice)}` : ''}
                        </p>
                      </div>
                      <Pill value={un.availability} />
                      <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />
                    </Link>
                  ))}
                </Section>
              </div>

              {/* ── 3 · TENANCIES ── */}
              <SectionHead id="sec-tenancies" no="Section 3 · Tenancies" q="Who is renting, and on what terms?" />
              {/* Lease mix takes the full row — it is the header for the section,
                  read before the two lists that break it down. */}
              <div className="mb-4">
                <LeaseMixCard ins={L.insights} />
              </div>
              {/* Renting now | Leases side by side; the customers who have GONE
                  get their own card below, so a former tenant is never counted
                  in with a current one. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Section title="Customers renting now" count={rentingCustomers.length}>
                  <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    Holding a live lease, or an in-flight renewal on a unit they occupy — the
                    same rule as the landlord&apos;s own Customers directory, so the two agree.
                  </p>
                  {rentingCustomers.map((c) => <CustomerRow key={c.tenantId} c={c} tone="active" />)}
                </Section>
                <Section title="Current leases" count={currentLeases.length}>
                  <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    Running now — activated, or post-dated cheques in hand. Counted per LEASE, so
                    this need not equal the landlord dashboard&apos;s tile, which counts one per unit.
                  </p>
                  {currentLeases.map((c) => <LeaseRow key={c.id} c={c} payments={paymentsByLease[c.id]?.length} />)}
                </Section>
              </div>

              {/* The other two phases, side by side underneath. Keeping them out
                  of "Current" is the point: 369 rows with only a status chip put a
                  tenancy that ended two years ago next to a running one. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                <Section title="Leases awaiting activation" count={awaitingLeases.length}>
                  <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    Drafted or issued, cheques not yet confirmed. Not earning, and not ended —
                    these are the ones still in the pipeline.
                  </p>
                  {awaitingLeases.map((c) => <LeaseRow key={c.id} c={c} payments={paymentsByLease[c.id]?.length} />)}
                </Section>

                <Section title="Ended leases" count={endedLeases.length}>
                  <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    Expired, terminated, or wound down through an accepted termination that has
                    taken effect — including rows whose status column still reads active.
                  </p>
                  {endedLeases.map((c) => <LeaseRow key={c.id} c={c} payments={paymentsByLease[c.id]?.length} />)}
                </Section>
              </div>

              {/* Customers who have GONE, kept apart from those who are here.
                  These are exactly the rows behind the gap between this page's
                  lifetime roster and the landlord's own active directory. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                <Section title="Customers with ended leases" count={endedCustomers.length}>
                  <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    Rented here before and hold no live lease now — whether the term simply expired
                    or the tenancy was terminated. The landlord&apos;s Ended Leases nav is narrower:
                    it lists only the terminated ones.
                  </p>
                  {endedCustomers.map((c) => <CustomerRow key={c.tenantId} c={c} tone="ended" />)}
                </Section>

                {/* Only rendered when it is non-empty: on most landlords there are
                    none, and an empty third card would imply a bucket that matters. */}
                {leadOnlyCustomers.length > 0 && (
                  <Section title="Converted leads, never signed" count={leadOnlyCustomers.length}>
                    <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
                      A lead was converted to a customer record but no contract ever followed. They
                      count in the roster total and in neither list above.
                    </p>
                    {leadOnlyCustomers.map((c) => <CustomerRow key={c.tenantId} c={c} tone="lead" />)}
                  </Section>
                )}
              </div>

              {/* ── 4 · MONEY ── */}
              <SectionHead id="sec-money" no="Section 4 · Money" q="What are they earning, and is it being collected?" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <CollectionsCard ins={L.insights} />
                <FinancialsPanel ins={L.insights} />
              </div>
              <div className="flex flex-col gap-4">
                {/* 5 · Payments — follows Leases, and each row names the lease it
                    belongs to, because a cheque only means something beside its
                    tenancy. */}
                <Section title="Payments" count={L.payments?.length ?? 0}>
                  <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    Most recent 200 rows, all payment types — fee rows appear here alongside rent, so this
                    does not tie to the rent-only collection figures above.
                    {unlinkedPayments > 0 && ` ${unlinkedPayments} row${unlinkedPayments === 1 ? '' : 's'} carry no lease.`}
                  </p>
                  {(L.payments ?? []).map((p) => (
                    <div key={p.id} className={ROW} style={ROW_STYLE}>
                      <Banknote size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                          {p.customerName}
                          {p.unitNumber && <span className="font-normal" style={{ color: 'var(--color-neutral-400)' }}> · Unit {p.unitNumber}</span>}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
                          {titleCase(p.paymentType)} · {fmtDate(p.transactionDate)}
                          {p.chequeNumber ? ` · cheque ${p.chequeNumber}` : ''}
                          {p.vatAmount > 0 ? ` · incl. VAT ${aed(p.vatAmount)}` : ''}
                        </p>
                      </div>
                      <span className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--color-neutral-900)' }}>{aed(p.amountPaid)}</span>
                      <Pill value={p.chequeStatus} />
                    </div>
                  ))}
                </Section>
              </div>

              {/* ── 5 · DEMAND ── */}
              <SectionHead id="sec-demand" no="Section 5 · Demand" q="Where is new business coming from?" />
              {/* Traffic first, then enquiries: the funnel reads left to right —
                  who looked, then who asked, then which listings did the work. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <TrafficPanel ins={L.insights} />
                <PipelinePanel ins={L.insights} />
              </div>
              <TopViewedPanel ins={L.insights} />

              {/* ── 6 · GOVERNANCE ── the rules this landlord charges under, and
                  who besides them can act on the account. */}
              <SectionHead id="sec-governance" no="Section 6 · Governance" q="Who else can act for them, and under what rules?" />
              {/* Charging rules — moved to the tail with the other
                  administrative panels, so the landlord's portfolio leads the
                  page. Only what this landlord actually set is rendered — empty
                  slots are dropped, not shown as "not set", so the panel reads
                  as data rather than a config form. */}
              {L.settings && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                  {(setPrefs.length > 0 || setPenalties.length > 0 || Object.keys(feeByCategory).length > 0) && (
                    <MiniPanel title="Charging rules">
                      <p className="text-xs mb-2" style={{ color: 'var(--color-neutral-400)' }}>
                        What this landlord charges customers. A fee dispute can be checked against this.
                      </p>
                      {/* Fee schedule from fee_rules, per space category (SCRUM-694).
                          Switched-off rules stay listed and greyed — a charge raised
                          under a rule later disabled still has to be explainable. */}
                      {Object.entries(feeByCategory).map(([category, rules]) => (
                        <div key={category}>
                          <Caption>{titleCase(category)} fees</Caption>
                          {rules.map((f) => (
                            <KV
                              key={f.id}
                              label={FEE_TYPE_LABELS[f.feeType ?? ''] ?? titleCase(f.feeType)}
                              value={
                                <span style={{ opacity: f.isActive ? 1 : 0.5 }}>
                                  {f.valueType === 'percentage' ? `${f.value}%` : aed(f.value)}
                                  {f.vatApplicable && f.vatRate > 0 && (
                                    <span style={{ color: 'var(--color-neutral-400)' }}> +{f.vatRate}% VAT</span>
                                  )}
                                  {!f.isActive && (
                                    <span style={{ color: 'var(--color-neutral-400)' }}> · off</span>
                                  )}
                                </span>
                              }
                              dot="var(--color-primary)"
                            />
                          ))}
                        </div>
                      ))}
                      {setPrefs.length > 0 && Object.keys(feeByCategory).length > 0 && <Divider />}
                      {setPrefs.length > 0 && (
                        <>
                          <Caption>Payment preferences</Caption>
                          {setPrefs.map(([label, value]) => <KV key={label} label={label} value={value} />)}
                        </>
                      )}
                      {setPenalties.length > 0 && (
                        <>
                          {setPrefs.length > 0 && <Divider />}
                          <Caption>Penalties &amp; charges</Caption>
                          {setPenalties.map(([label, value]) => (
                            <KV key={label} label={label} value={value} dot="var(--color-gold)" />
                          ))}
                        </>
                      )}
                    </MiniPanel>
                  )}

                  {setCaps.length > 0 && (
                    <MiniPanel title="Settlement discount caps">
                      <p className="text-xs mb-2" style={{ color: 'var(--color-neutral-400)' }}>
                        The most a manager may waive on a final settlement, per category.
                      </p>
                      {setCaps.map(([label, value]) => <KV key={label} label={label} value={value} />)}
                    </MiniPanel>
                  )}
                </div>
              )}
              {/* Delegated access closes the page. It used to sit up in the
                  settings block beside the charging rules, which pushed the
                  landlord's own portfolio down the page behind other people's
                  permissions. */}
              <div className="mt-4">
                <Section title="Managers with access" count={L.managers?.length ?? 0}>
                  {(L.managers ?? []).map((mg) => (
                    <Link key={mg.userId} href={`/dashboard/admin/users/${mg.userId}`} className={`${ROW} transition-colors hover:brightness-95`} style={{ ...ROW_STYLE, opacity: mg.isActive ? 1 : 0.6 }}>
                      <UserCog size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate flex items-center gap-2" style={{ color: 'var(--color-neutral-900)' }}>
                          {mg.name}
                          {!mg.isActive && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>
                              Revoked
                            </span>
                          )}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
                          {mg.grantedCount} permissions · since {fmtDate(mg.grantedAt)}
                          {mg.grantedByRole ? ` · granted by ${titleCase(mg.grantedByRole)}` : ''}
                        </p>
                      </div>
                      {mg.accountStatus && <Pill value={mg.accountStatus} />}
                      <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />
                    </Link>
                  ))}
                </Section>
              </div>

              {/* ── 7 · ACTIVITY ── */}
              <SectionHead id="sec-activity" no="Section 7 · Activity" q="What has been happening on this account?" />
              <div className="flex flex-col gap-4">
                {/* Own-account audit trail. Manager work for this landlord is
                    attributed to the manager and lives on the manager's page. */}
                <Section title="Recent activity" count={L.activity?.recent.length ?? 0}>
                  <p className="text-[11px] px-1 pb-1" style={{ color: 'var(--color-neutral-400)' }}>
                    {L.activity
                      ? `${L.activity.summary.totalActions} actions all time · ${L.activity.summary.last30dActions} in the last 30 days`
                      : ''}
                  </p>
                  {(L.activity?.recent ?? []).map((a, i) => (
                    <div key={i} className={ROW} style={ROW_STYLE}>
                      <Clock size={14} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{titleCase(a.actionKey)}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{titleCase(a.entityType)} #{a.entityId}</p>
                      </div>
                      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-neutral-400)' }}>{fmtDate(a.createdAt)}</span>
                    </div>
                  ))}
                </Section>
              </div>
            </>
          )}

          {M && <ManagerView m={M} />}
          {C && <CustomerView c={C} />}
          {S && <StaffView s={S} role={u.role} />}
          {SP && <SpView sp={SP} />}

          {!L && !M && !C && !S && !SP && (
            <p className="text-sm bg-white rounded-2xl p-4" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>
              No additional breakdown for {roleLabel[u.role] ?? u.role} accounts yet.
            </p>
          )}
        </>
      )}
    </DashboardPage>
  );
}
