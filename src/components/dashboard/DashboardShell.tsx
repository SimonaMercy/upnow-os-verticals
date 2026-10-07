'use client';

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Home, Search, Building2, FileText, CalendarCheck, Wrench, Users, Star, Wallet, BookOpen, Bell, Settings, LogOut, Menu, X, ChevronRight, ChevronLeft, ShieldCheck, ShieldAlert, BarChart2, AlertTriangle, Inbox, Briefcase, UserCircle, TrendingUp, UserCheck, Mail, Receipt, BedDouble, Heart, HelpCircle, Archive, ClipboardList, ClipboardCheck, SlidersHorizontal, LineChart, Activity, Gauge, FileSignature, HeartPulse, MapPin, Scale, MessageCircle } from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { useAuth, dashboardPath, UserRole } from '@/contexts/AuthContext';
import { buildDisplayName } from '@/lib/utils';
import { cn } from '@/lib/utils';
import shell from './DashboardShell.module.css';
import { getSpOnboardingReady, subscribeSpOnboardingReady } from './shellChrome';
import { apiGet } from '@/lib/api';
import { EMAILS_SYNCED_EVENT, useEmailSyncOnLogin } from '@/lib/useEmailSyncOnLogin';
import { useWhatsappEnabled } from '@/lib/useWhatsappEnabled';
import { whatsappEnabled } from '@/lib/whatsappApi';

// ── Manager permission cache (loaded once per session) ──────────────────────
// Keeps the FULL per-landlord permission set so the nav can re-scope to the
// landlord chosen in the LandlordSwitcher (?rp=). With a landlord selected, a
// section shows only if THAT landlord granted the flag; with "All landlords"
// selected we show the union (any landlord grants it).
type RpPerm = { rentalProviderId: number; permissions: Record<string, boolean> };
let _managerRps: RpPerm[] | null = null;
let _managerPermsLoaded = false;
function useManagerNavPerms(role: UserRole): Record<string, boolean> {
  const [rps, setRps] = useState<RpPerm[]>([]);
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  useEffect(() => {
    if (role !== 'manager') return;
    if (_managerPermsLoaded) { setRps(_managerRps ?? []); return; }
    apiGet<RpPerm[]>('/manager/my-rps')
      .then(data => {
        _managerRps = data;
        _managerPermsLoaded = true;
        setRps(data);
      })
      .catch(() => { _managerPermsLoaded = true; });
  }, [role]);

  if (selectedRp) {
    const one = rps.find(r => String(r.rentalProviderId) === selectedRp);
    return one?.permissions ?? {};
  }
  const merged: Record<string, boolean> = {};
  rps.forEach(r => Object.entries(r.permissions).forEach(([k, v]) => { if (v) merged[k] = true; }));
  return merged;
}

/* ─────────────────────────────────────────────
   Nav definitions per role
───────────────────────────────────────────── */
/** Keys for the cheap sidebar count badges (GET /api/properties/nav-counts). */
type NavBadgeKey = 'leads' | 'properties' | 'units' | 'operations' | 'emails' | 'whatsapp';
type NavCounts = Partial<Record<NavBadgeKey, number>>;

// Maintenance → Requests was hidden on PRODUCTION builds while it was being built (owner, 10 Sep 2026).
// Switched on everywhere on 21 Sep 2026 (owner: "let's enable the tabs that we hide for production") —
// the restoration / own-team jobs, the Units page and the Vacant Units report all lead to it.

// Owner's v32 pattern (this branch is the preview): `tone` marks which layer an
// item belongs to — 'shared' = dark-green shared UpNow OS (reused by every
// vertical), 'pack' = light-green Spaces pack (property-specific records).
type NavTone = 'shared' | 'pack';

type NavItem =
  // `match` lists extra path prefixes that also activate the item — for sections
  // whose detail pages live under a different route than the nav href (e.g. the
  // Leases list is /orders but a lease opens at /contracts/:id/v2).
  // `hidden` parks a section: the entry stays here (route, icon, position) but
  // is dropped from the rail. See the HIDDEN note below.
  | { label: string; href: string; icon: React.ElementType; soon?: boolean; requirePerm?: string | string[]; badgeKey?: NavBadgeKey; match?: string[]; hidden?: true; tone?: NavTone;
      /** Dropped for a finance-only manager (money flags, no lease / listing / editing / maintenance authority) — the pricing tool is not theirs. */
      financeHidden?: true }
  | { divider: true }
  | { section: string; tone?: NavTone };

/**
 * HIDDEN sections (3 Aug 2026) — parked for a later development cycle:
 * **Communications** and **Analytics** (AMC un-parked 6 Sep 2026 — it sits
 * under the Maintenance section until it folds into the vendor pages). They carry
 * `hidden: true` below, which drops them from the rail for every role while
 * leaving the entry (route, icon, ordering) recorded in place. The pages,
 * routes and APIs are untouched and still reachable by URL, so nothing is lost
 * and un-hiding is a one-word edit. Applied to the manager rail too, since the
 * manager portal mirrors the RP one. NOTE: Reports still carries a "View
 * analytics" cross-link (`reports/page.tsx`) — deliberately left, since Reports
 * is where Analytics belongs once it returns.
 */
/** v2 (0260): a landlord-invited vendor's LIGHT portal — its jobs, its
 *  people, its profile. No marketplace chrome (services, earnings, reviews,
 *  live map): those belong to the tier the vendor may upgrade to later.
 *  Picked over NAV.service_provider when the onboarding gate stamped
 *  sp_tier = landlord_vendor (SpOnboardingGate). */
/** The SP tier the onboarding gate stamped — reactive, because the stamp
 *  lands after first render (sessionStorage + the gate's 'sp-tier' event). */
function useSpTier(): string | null {
  const [tier, setTier] = useState<string | null>(() => {
    try { return sessionStorage.getItem('sp_tier'); } catch { return null; }
  });
  useEffect(() => {
    const on = (e: Event) => setTier((e as CustomEvent<string>).detail ?? null);
    window.addEventListener('sp-tier', on);
    return () => window.removeEventListener('sp-tier', on);
  }, []);
  return tier;
}

const SP_LIGHT_NAV: NavItem[] = [
  // A landlord's own vendor works jobs the landlord runs from THEIR page: no
  // booking exists, so /operations (a booking board) was permanently empty for
  // this tier — the owner signed in as their crew and saw nothing while nine
  // jobs stood against them (29 Sep 2026). My jobs is that crew's real board.
  { label: 'Jobs',        href: '/dashboard/service-provider/my-jobs',    icon: ClipboardList, match: ['/dashboard/service-provider/jobs', '/dashboard/service-provider'] },
  { label: 'Technicians', href: '/dashboard/service-provider/team',       icon: Users },
  { divider: true },
  { label: 'Profile',     href: '/dashboard/service-provider/settings',   icon: Settings },
];

const NAV: Record<UserRole, NavItem[]> = {
  customer: [
    { label: 'My Spaces',   href: '/dashboard/customer/spaces',   icon: BedDouble },
    { label: 'My Services', href: '/dashboard/customer/services', icon: Wrench },
    { label: 'My Profile',  href: '/dashboard/customer/profile',  icon: UserCircle },
  ],
  // v32 preview: the landlord rail is derived from OS_GROUPS (buildOsRail) —
  // one dark/light tab per prototype group; the folded pages surface as an
  // in-page tab strip (OsGroupTabs).
  rental_provider: [],
  service_provider: [
    // Onboarding, Team and Documents intentionally have no nav entries:
    // onboarding is where the gate sends unapproved accounts, Team lives in
    // Settings → Team, Documents in Settings → Profile. Jobs has none either:
    // Operations IS the job board; /jobs now redirects there and /jobs/[id]
    // (the job detail) is reached by opening a card.
    { label: 'Overview',         href: '/dashboard/service-provider',            icon: LayoutDashboard },
    { label: 'Operations',       href: '/dashboard/service-provider/operations', icon: ClipboardList, match: ['/dashboard/service-provider/jobs'] },
    // Jobs a landlord runs from their own page — no booking, so they never
    // reach Operations. Empty for a vendor nobody self-manages.
    { label: 'My jobs',          href: '/dashboard/service-provider/my-jobs',    icon: ClipboardList },
    // SP-86 · where every technician is right now (presence + last fix + live job)
    { label: 'Live map',         href: '/dashboard/service-provider/live',       icon: MapPin },
    // SP-103 · who works when and where: shifts per technician, zones, conflicts
    { label: 'Roster',           href: '/dashboard/service-provider/schedule',   icon: CalendarCheck },
    { label: 'My Services',      href: '/dashboard/service-provider/services',   icon: Briefcase },
    { label: 'Reviews',          href: '/dashboard/service-provider/reviews',    icon: Star },
    { divider: true },
    { section: 'More' },
    { label: 'Earnings',         href: '/dashboard/service-provider/earnings',   icon: Wallet },
    { label: 'Settings',         href: '/dashboard/service-provider/settings',   icon: Settings },
  ],
  // v32 preview: like the landlord rail, the manager rail comes from
  // OS_GROUPS (buildOsRail) — every requirePerm gate is on the group children,
  // so an undelegated page drops from the tab strip and a fully undelegated
  // group drops its rail tab, exactly as the flat rail behaved.
  manager: [],
  technician: [
    { label: 'Overview',         href: '/dashboard/technician',                icon: LayoutDashboard },
    { label: 'My Jobs',          href: '/dashboard/technician/jobs',           icon: CalendarCheck },
    // SP-103 · the shifts my provider rostered me on (zones, conflicts, confirm)
    { label: 'My shifts',        href: '/dashboard/technician/schedule',       icon: CalendarCheck },
    // SP-131: the technician's own KYC (Emirates ID + visa) — the inputs to their Gate 1 verdict.
    { label: 'My Documents',     href: '/dashboard/technician/documents',      icon: FileText },
    // SP-182 · released-escrow earnings on the jobs I did (read-only)
    { label: 'Earnings',         href: '/dashboard/technician/earnings',       icon: Wallet },
    { divider: true },
    { label: 'Settings',         href: '/dashboard/technician/settings',       icon: Settings, soon: true },
  ],
  admin: [
    // `/dashboard/admin` now renders Platform Pulse, so Overview IS the pulse —
    // the separate "Platform Pulse" entry would be a second door to one room.
    { label: 'Overview',         href: '/dashboard/admin',                     icon: Gauge, match: ['/dashboard/admin/pulse'] },
    { label: 'Activity',         href: '/dashboard/admin/activity',            icon: Activity, hidden: true },
    { section: 'Users' },
    { label: 'User Management',  href: '/dashboard/admin/users',               icon: Users },
    { label: 'Profile Verification', href: '/dashboard/admin/kyc',             icon: ShieldCheck },
    // The two provider types get their own sections — they are different
    // businesses with different surfaces, and lumping them under one "Listings"
    // header hid that. Platform Billing sits under Rental Provider because it
    // bills exactly them (subscription + lease origination / renewal /
    // settlement fees); the SP side is commission-based and billed elsewhere.
    { section: 'Rental Provider' },
    { label: 'Listings',         href: '/dashboard/admin/listings/rental-providers',  icon: Building2 },
    { label: 'Platform Billing', href: '/dashboard/admin/billing',             icon: Receipt },
    { section: 'Service Provider' },
    // Dispatch is the daily operational surface for the SP business — the
    // needs-assignment queue and the live job board — so it leads the section
    // ahead of the configuration surfaces. It was built but left hidden, which
    // meant the only way in was typing the URL.
    { label: 'Dispatch',         href: '/dashboard/admin/operations',          icon: ClipboardList, match: ['/dashboard/admin/operations'] },
    { label: 'Listings',         href: '/dashboard/admin/listings/service-providers', icon: Wrench },
    { label: 'Service Catalog',  href: '/dashboard/admin/catalog',             icon: SlidersHorizontal },
    // Reviews, Payouts and Disputes are SP-business surfaces, not general admin
    // ones: reviews are of a service provider on a booking, payouts settle SP
    // earnings, disputes are raised against SP jobs. They live under this
    // section rather than in a loose block at the bottom of the rail.
    { label: 'Reviews',          href: '/dashboard/admin/reviews',             icon: Star },
    { label: 'Payouts',          href: '/dashboard/admin/payouts',             icon: Wallet },
    { label: 'Disputes',         href: '/dashboard/admin/disputes',            icon: AlertTriangle },
    { divider: true },
    { label: 'Risk',             href: '/dashboard/admin/risk',                icon: ShieldAlert, hidden: true },
    { divider: true },
    // Platform-wide surfaces — not tied to either provider business.
    { section: 'Platform' },
    // SP-252 — the versioned platform agreement providers accept; publish + acceptance evidence.
    // It is a platform document (audience-scoped: provider today, others later), so it lives
    // here rather than under one provider section.
    { label: 'Platform Agreement', href: '/dashboard/admin/agreements',        icon: FileSignature },
    // Legal & breach — the jurisdiction rule book (cure periods, notice days, filing fee).
    { label: 'Jurisdiction',     href: '/dashboard/admin/legal',               icon: Scale },
    { label: 'Analytics',        href: '/dashboard/admin/analytics',           icon: BarChart2, hidden: true },
    { label: 'Platform Status',  href: '/dashboard/admin/status',              icon: HeartPulse },
    { label: 'Inbox',            href: '/dashboard/admin/inbox',               icon: Inbox, hidden: true },
    { label: 'Settings',         href: '/dashboard/admin/settings',            icon: Settings, soon: true, hidden: true },
  ],
  super_admin: [
    // `/dashboard/admin` now renders Platform Pulse, so Overview IS the pulse —
    // the separate "Platform Pulse" entry would be a second door to one room.
    { label: 'Overview',         href: '/dashboard/admin',                     icon: Gauge, match: ['/dashboard/admin/pulse'] },
    { label: 'Activity',         href: '/dashboard/admin/activity',            icon: Activity, hidden: true },
    { section: 'Users' },
    { label: 'User Management',  href: '/dashboard/admin/users',               icon: Users },
    { label: 'Profile Verification', href: '/dashboard/admin/kyc',             icon: ShieldCheck },
    // The two provider types get their own sections — they are different
    // businesses with different surfaces, and lumping them under one "Listings"
    // header hid that. Platform Billing sits under Rental Provider because it
    // bills exactly them (subscription + lease origination / renewal /
    // settlement fees); the SP side is commission-based and billed elsewhere.
    { section: 'Rental Provider' },
    { label: 'Listings',         href: '/dashboard/admin/listings/rental-providers',  icon: Building2 },
    { label: 'Platform Billing', href: '/dashboard/admin/billing',             icon: Receipt },
    { section: 'Service Provider' },
    // Dispatch is the daily operational surface for the SP business — the
    // needs-assignment queue and the live job board — so it leads the section
    // ahead of the configuration surfaces. It was built but left hidden, which
    // meant the only way in was typing the URL.
    { label: 'Dispatch',         href: '/dashboard/admin/operations',          icon: ClipboardList, match: ['/dashboard/admin/operations'] },
    { label: 'Listings',         href: '/dashboard/admin/listings/service-providers', icon: Wrench },
    { label: 'Service Catalog',  href: '/dashboard/admin/catalog',             icon: SlidersHorizontal },
    // Reviews, Payouts and Disputes are SP-business surfaces, not general admin
    // ones: reviews are of a service provider on a booking, payouts settle SP
    // earnings, disputes are raised against SP jobs. They live under this
    // section rather than in a loose block at the bottom of the rail.
    { label: 'Reviews',          href: '/dashboard/admin/reviews',             icon: Star },
    { label: 'Payouts',          href: '/dashboard/admin/payouts',             icon: Wallet },
    { label: 'Disputes',         href: '/dashboard/admin/disputes',            icon: AlertTriangle },
    { divider: true },
    { label: 'Risk',             href: '/dashboard/admin/risk',                icon: ShieldAlert, hidden: true },
    { divider: true },
    // Platform-wide surfaces — not tied to either provider business.
    { section: 'Platform' },
    // SP-252 — the versioned platform agreement providers accept; publish + acceptance evidence.
    // It is a platform document (audience-scoped: provider today, others later), so it lives
    // here rather than under one provider section.
    { label: 'Platform Agreement', href: '/dashboard/admin/agreements',        icon: FileSignature },
    // Legal & breach — the jurisdiction rule book (cure periods, notice days, filing fee).
    { label: 'Jurisdiction',     href: '/dashboard/admin/legal',               icon: Scale },
    { label: 'Analytics',        href: '/dashboard/admin/analytics',           icon: BarChart2, hidden: true },
    { label: 'Platform Status',  href: '/dashboard/admin/status',              icon: HeartPulse },
    { label: 'Inbox',            href: '/dashboard/admin/inbox',               icon: Inbox, hidden: true },
    { label: 'Settings',         href: '/dashboard/admin/settings',            icon: Settings, soon: true, hidden: true },
  ],
};

/* ─────────────────────────────────────────────
   v32 preview groups — the single source of truth for the landlord and
   manager navigation on this branch. One rail tab per prototype group
   (dark = shared UpNow OS, light = Spaces pack); the pages that fold into a
   group appear as an in-page tab strip (OsGroupTabs) instead of extra rail
   rows. Grouping per the prototype's currentMap. Every existing route keeps
   an entry (parity gate).
───────────────────────────────────────────── */
type OsChild = { label: string; href: string; badgeKey?: NavBadgeKey; requirePerm?: string | string[]; match?: string[]; hidden?: true; financeHidden?: true };
// `soon` = the prototype tab has no page yet: the rail shows it dimmed with an
// "In development" chip (no link, no children).
type OsGroup = { label: string; icon: React.ElementType; tone: NavTone; badgeKey?: NavBadgeKey; soon?: true; children: OsChild[] };

const RP_BASE = '/rental-provider/dashboard';
const MGR_BASE = '/dashboard/manager';

const OS_GROUPS: Partial<Record<UserRole, OsGroup[]>> = {
  rental_provider: [
    { label: 'Demand', icon: TrendingUp, tone: 'shared', badgeKey: 'leads', children: [
      { label: 'Leads', href: `${RP_BASE}/leads` },
    ] },
    // The lead/viewing calendar already exists as a view of the Leads page —
    // the tab deep-links it (owner, 29 Sep: "calendar we already have linked
    // with lead").
    { label: 'Calendar', icon: CalendarCheck, tone: 'shared', children: [
      { label: 'Calendar', href: `${RP_BASE}/leads?view=calendar` },
    ] },
    { label: 'Communications', icon: Mail, tone: 'shared', children: [
      { label: 'Emails', href: `${RP_BASE}/communications`, badgeKey: 'emails' },
      { label: 'WhatsApp', href: `${RP_BASE}/whatsapp`, badgeKey: 'whatsapp' },
    ] },
    // No shared Finance tab: Payments and Deposits are the lease money and
    // live in the pack's Transactions tab (owner, 29 Sep: "payments related
    // things will fall in Transactions").
    { label: 'Settings', icon: Settings, tone: 'shared', children: [
      { label: 'Settings', href: `${RP_BASE}/settings`, match: [`${RP_BASE}/maintenance-list`, `${RP_BASE}/restoration-list`, `${RP_BASE}/amc/categories`] },
      // Templates sit with the operating configuration (owner, 29 Sep).
      { label: 'Templates', href: `${RP_BASE}/templates` },
      { label: 'My Profile', href: `${RP_BASE}/profile` },
    ] },
    { label: 'Overview', icon: LayoutDashboard, tone: 'pack', children: [
      { label: 'Overview', href: RP_BASE },
    ] },
    { label: 'Portfolio', icon: Building2, tone: 'pack', children: [
      { label: 'Properties', href: `${RP_BASE}/portfolio`, badgeKey: 'properties' },
      { label: 'Units', href: `${RP_BASE}/units`, badgeKey: 'units' },
    ] },
    { label: 'Customers', icon: UserCheck, tone: 'pack', children: [
      { label: 'Customers', href: `${RP_BASE}/tenants` },
    ] },
    { label: 'Leases', icon: FileText, tone: 'pack', children: [
      { label: 'Leases', href: `${RP_BASE}/orders`, match: [`${RP_BASE}/contracts`] },
      { label: 'Ended Leases', href: `${RP_BASE}/ended-leases` },
    ] },
    // Transactions = the money moving on the leases (owner, 29 Sep). One page:
    // deposits are a tab INSIDE Payments (/deposits is a legacy redirect,
    // SCRUM-577), so the tab opens the ledger directly with no strip.
    { label: 'Transactions', icon: Wallet, tone: 'pack', children: [
      { label: 'Payments', href: `${RP_BASE}/payments`, match: [`${RP_BASE}/deposits`] },
    ] },
    // Operations keeps its rail badge: that one IS a worklist length, a single fact.
    { label: 'Operations', icon: ClipboardList, tone: 'pack', badgeKey: 'operations', children: [
      { label: 'Ops Board', href: `${RP_BASE}/operations` },
    ] },
    // Prototype: "Staff activity + provider costs → Spaces → Performance &
    // Economics" — the Team activity overview is that page today. LANDLORD-ONLY
    // (the API refuses managers), so the manager groups have no counterpart.
    // It follows Transactions and Operations directly (owner, 4 Oct:
    // "Transaction, operations and performance & economics together").
    { label: 'Performance & Economics', icon: LineChart, tone: 'pack', children: [
      { label: 'Team', href: `${RP_BASE}/team` },
    ] },
    // Maintenance = upkeep of the units: the requests, who does the work and
    // the standing contracts (owner, 4 Oct: "create maintenance menu and move them").
    { label: 'Maintenance', icon: Wrench, tone: 'pack', children: [
      { label: 'Requests', href: `${RP_BASE}/maintenance`, match: [`${RP_BASE}/maintenance/`] },
      { label: 'Vendors', href: `${RP_BASE}/vendors` },
      // AMC folds into the vendor pages when the commitments layer lands.
      { label: 'AMC', href: `${RP_BASE}/amc` },
      // Building inspections (0383): each building's monthly / quarterly walk-through.
      { label: 'Building inspections', href: `${RP_BASE}/building-inspections`, match: [`${RP_BASE}/building-inspections/`] },
    ] },
    // Two pipelines, two pages (owner, 14 Sep: "keep breaches and Legal separate — separate pages").
    { label: 'Cases', icon: Scale, tone: 'pack', children: [
      { label: 'Breaches', href: `${RP_BASE}/breaches` },
      { label: 'Legal', href: `${RP_BASE}/legal` },
    ] },
    { label: 'Reports', icon: BarChart2, tone: 'pack', children: [
      { label: 'Reports', href: `${RP_BASE}/reports` },
      { label: 'Analytics', href: `${RP_BASE}/analytics`, hidden: true },
    ] },
    // No Business tab for now (owner, 4 Oct: "Business you can remove for
    // now") — the provider's own company (entities, branches, payables,
    // people, P&L in the prototype) has no page yet.
  ],
  manager: [
    { label: 'Demand', icon: TrendingUp, tone: 'shared', children: [
      { label: 'Leads', href: `${MGR_BASE}/leads`, requirePerm: 'canManageViewings', match: [`${MGR_BASE}/viewings`] },
    ] },
    { label: 'Calendar', icon: CalendarCheck, tone: 'shared', children: [
      { label: 'Calendar', href: `${MGR_BASE}/leads?view=calendar`, requirePerm: 'canManageViewings' },
    ] },
    { label: 'Communications', icon: Mail, tone: 'shared', children: [
      { label: 'Emails', href: `${MGR_BASE}/communications`, requirePerm: 'canReadEmails' },
      { label: 'WhatsApp', href: `${MGR_BASE}/whatsapp`, requirePerm: 'canReadWhatsapp' },
    ] },
    { label: 'Settings', icon: Settings, tone: 'shared', children: [
      // Settings holds the delegated lists (maintenance coverage, restoration,
      // AMC categories) — not for a finance-only member (owner, 23 Sep 2026).
      { label: 'Settings', href: `${MGR_BASE}/settings`, financeHidden: true, match: [`${MGR_BASE}/maintenance-coverage`, `${MGR_BASE}/maintenance-list`, `${MGR_BASE}/restoration-list`, `${MGR_BASE}/amc/categories`] },
      // Templates sit with the operating configuration (owner, 29 Sep).
      { label: 'Templates', href: `${MGR_BASE}/templates`, requirePerm: 'canManageTemplates' },
      { label: 'My Profile', href: `${MGR_BASE}/profile` },
    ] },
    { label: 'Overview', icon: LayoutDashboard, tone: 'pack', children: [
      { label: 'Overview', href: MGR_BASE },
    ] },
    { label: 'Portfolio', icon: Building2, tone: 'pack', children: [
      { label: 'Properties', href: `${MGR_BASE}/properties`, requirePerm: 'canListProperties' },
      { label: 'Units', href: `${MGR_BASE}/units`, requirePerm: 'canListProperties', financeHidden: true },
    ] },
    { label: 'Customers', icon: UserCheck, tone: 'pack', children: [
      { label: 'Customers', href: `${MGR_BASE}/tenants`, requirePerm: 'canManageAgreements' },
    ] },
    { label: 'Leases', icon: FileText, tone: 'pack', children: [
      { label: 'Leases', href: `${MGR_BASE}/contracts`, requirePerm: 'canManageAgreements' },
      { label: 'Ended Leases', href: `${MGR_BASE}/ended-leases`, requirePerm: 'canManageAgreements' },
    ] },
    // Transactions = the money moving on the leases (owner, 29 Sep). One page:
    // deposits are a tab INSIDE Payments (/deposits is a legacy redirect).
    { label: 'Transactions', icon: Wallet, tone: 'pack', children: [
      { label: 'Payments', href: `${MGR_BASE}/payments`, requirePerm: 'canManageDeposits', match: [`${MGR_BASE}/deposits`] },
    ] },
    { label: 'Operations', icon: ClipboardList, tone: 'pack', children: [
      { label: 'Ops Board', href: `${MGR_BASE}/operations`, requirePerm: 'canManageAgreements' },
    ] },
    { label: 'Maintenance', icon: Wrench, tone: 'pack', children: [
      { label: 'Requests', href: `${MGR_BASE}/maintenance`, requirePerm: 'canManageMaintenance', match: [`${MGR_BASE}/maintenance/`] },
      { label: 'Vendors', href: `${MGR_BASE}/vendors`, requirePerm: 'canManageVendors' },
      // Either flag opens AMC: the coordinator (contracts & visits) or the
      // finance manager (bills, installments, expenses report) — 0319.
      { label: 'AMC', href: `${MGR_BASE}/amc`, requirePerm: ['canManageAmc', 'canRecordVendorPayments'] },
      { label: 'Building inspections', href: `${MGR_BASE}/building-inspections`, requirePerm: 'canManageInspections', match: [`${MGR_BASE}/building-inspections/`] },
    ] },
    { label: 'Cases', icon: Scale, tone: 'pack', children: [
      { label: 'Breaches', href: `${MGR_BASE}/breaches`, requirePerm: 'canManageLegal' },
      { label: 'Legal', href: `${MGR_BASE}/legal`, requirePerm: 'canManageLegal' },
    ] },
    { label: 'Reports', icon: BarChart2, tone: 'pack', children: [
      { label: 'Reports', href: `${MGR_BASE}/reports`, requirePerm: 'canViewReports' },
      { label: 'Analytics', href: `${MGR_BASE}/analytics`, requirePerm: 'canViewReports', hidden: true },
    ] },
  ],
};

// Finance-only = holds a money flag and none of the working flags. Units
// (layout pricing) and the delegated Settings lists are not on their map
// (owner, 23 Sep 2026). Shared by the rail and the tab strip.
function isFinanceOnly(role: UserRole, perms: Record<string, boolean>): boolean {
  return role === 'manager'
    && (perms.canRecordPayments || perms.canClearCheques || perms.canManageCollections)
    && !perms.canManageAgreements && !perms.canEditProperties && !perms.canManageViewings && !perms.canManageMaintenance;
}

/** A group's children this user can see — same rules as the flat rail applied:
 *  parked entries drop, WhatsApp drops without a bridge, manager permission
 *  gates and the finance-only carve-out apply per child. */
function visibleOsChildren(group: OsGroup, role: UserRole, managerPerms: Record<string, boolean>, waOn: boolean, financeOnly: boolean): OsChild[] {
  return group.children.filter(c => {
    if (c.hidden) return false;
    if (!waOn && c.href.endsWith('/whatsapp')) return false;
    if (role === 'manager') {
      if (c.financeHidden && financeOnly) return false;
      if (c.requirePerm) {
        const need = Array.isArray(c.requirePerm) ? c.requirePerm : [c.requirePerm];
        if (!need.some(f => managerPerms[f] === true)) return false;
      }
    }
    return true;
  });
}

/** Rail items from OS_GROUPS: one tab per group with visible children, its
 *  href the first page the user can open, its `match` covering every child so
 *  the tab highlights wherever inside the group the user is. The two layer
 *  headers and the divider between them are inserted where the tone flips. */
function buildOsRail(role: UserRole, managerPerms: Record<string, boolean>, waOn: boolean): NavItem[] {
  const groups = OS_GROUPS[role] ?? [];
  const financeOnly = isFinanceOnly(role, managerPerms);
  const items: NavItem[] = [];
  let toneSeen: NavTone | null = null;
  for (const g of groups) {
    const kids = visibleOsChildren(g, role, managerPerms, waOn, financeOnly);
    if (!g.soon && !kids.length) continue;
    if (g.tone !== toneSeen) {
      if (toneSeen) items.push({ divider: true });
      items.push({ section: g.tone === 'shared' ? 'Shared UpNow OS' : 'Spaces pack', tone: g.tone });
      toneSeen = g.tone;
    }
    if (g.soon) {
      // No page behind it yet — dimmed placeholder with an "In development"
      // chip; the href is only a stable React key, soon-items never link.
      items.push({ label: g.label, href: `#soon-${g.label}`, icon: g.icon, tone: g.tone, soon: true });
      continue;
    }
    const [first, ...rest] = kids;
    items.push({
      label: g.label,
      href: first.href,
      icon: g.icon,
      badgeKey: g.badgeKey,
      tone: g.tone,
      match: [...rest.map(k => k.href), ...kids.flatMap(k => k.match ?? [])],
    });
  }
  return items;
}

const ROLE_LABEL: Record<UserRole, string> = {
  customer:          'Customer',
  rental_provider:  'Rental Provider',
  service_provider: 'Service Provider',
  manager:          'Asset Manager',
  technician:       'Technician',
  admin:            'Admin',
  super_admin:      'Super Admin',
};

/* ─────────────────────────────────────────────
   Sidebar count badges — one cheap scalar fetch per session (RP only),
   refreshed on tab focus (throttled). Never blocks render; on any failure
   the badges simply stay hidden.
───────────────────────────────────────────── */
function useNavBadgeCounts(role: UserRole): NavCounts {
  const [counts, setCounts] = useState<NavCounts>({});
  useEffect(() => {
    if (role !== 'rental_provider') return;   // no endpoint for other roles → no badges
    let cancelled = false;
    let last = 0;
    const load = () => {
      last = Date.now();
      // properties/nav-counts → leads/properties/units; contracts/nav-counts →
      // leases + operations, computed off the same logic as those pages so the
      // badges never drift from the page counts.
      Promise.all([
        fetch('/api/properties/nav-counts', { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/contracts/nav-counts', { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/email/unread-count', { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
        // Not asked at all where WhatsApp is switched off — it would only be refused.
        whatsappEnabled().then(on => (on ? fetch('/api/whatsapp/unread-count', { credentials: 'include' }).then(r => (r.ok ? r.json() : null)) : null)).catch(() => null),
      ])
        .then(([p, c, e, w]: [NavCounts | null, { leases?: number; operations?: number } | null, { unread?: number } | null, { unread?: number } | null]) => {
          if (cancelled || (!p && !c)) return;
          setCounts({
            leads:      Number(p?.leads ?? 0),
            properties: Number(p?.properties ?? 0),
            units:      Number(p?.units ?? 0),
            operations: Number(c?.operations ?? 0),
            emails:     Number(e?.unread ?? 0),
            whatsapp:   Number(w?.unread ?? 0),
          });
        })
        .catch(() => { /* keep last-known / empty */ });
    };
    load();
    // Mail just came in (the login sync, or the look every few minutes): the badge follows.
    const onSynced = () => load();
    window.addEventListener(EMAILS_SYNCED_EVENT, onSynced);
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 30_000) return;   // throttle re-fetch on focus churn
      load();
    };
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); window.removeEventListener(EMAILS_SYNCED_EVENT, onSynced); };
  }, [role]);
  return counts;
}

/* ─────────────────────────────────────────────
   Sidebar
───────────────────────────────────────────── */
function Sidebar({
  role,
  pathname,
  onClose,
  collapsed = false,
  counts = {},
}: {
  role: UserRole;
  pathname: string;
  onClose?: () => void;
  collapsed?: boolean;
  counts?: NavCounts;
}) {
  const managerPerms = useManagerNavPerms(role);
  const waOn = useWhatsappEnabled(role);
  const navSearchParams = useSearchParams();
  // Carry the manager's chosen landlord (?rp=) onto every sidebar link so
  // navigating between sections keeps the same landlord in view instead of
  // resetting to "All landlords". ManagerScopeSync is the safety net for any
  // other entry point; this just avoids a scope flash on sidebar clicks.
  const scopeRp = role === 'manager' ? navSearchParams.get('rp') : null;
  const withScope = (href: string) =>
    scopeRp && href.startsWith('/dashboard/manager') ? `${href}${href.includes('?') ? '&' : '?'}rp=${scopeRp}` : href;
  // Parked sections (see the HIDDEN note on NAV) drop out for every role, ahead
  // of the manager permission filter so an emptied section header still goes.
  // The onboarding gate stamps the SP tier (sessionStorage + an 'sp-tier'
  // event, since the stamp lands AFTER this shell first renders); a light
  // vendor gets its own nav.
  const spTier = useSpTier();
  const baseNav = role === 'service_provider' && spTier === 'landlord_vendor'
    ? SP_LIGHT_NAV
    : OS_GROUPS[role]
      ? buildOsRail(role, managerPerms, waOn)
      : (NAV[role] ?? []);
  // WhatsApp has no entry where the environment has no bridge to run it through.
  const rawNav = baseNav.filter(item => !('hidden' in item && item.hidden))
    .filter(item => waOn || !('href' in item && typeof item.href === 'string' && item.href.endsWith('/whatsapp')));
  // For managers: hide nav items whose requirePerm flag isn't granted, then drop
  // any section header left with no visible links under it (so a landlord that
  // withholds, say, all Finance permissions doesn't leave an empty "Finance").
  // Finance-only = holds a money flag and none of the working flags. Units
  // (layout pricing) is not on their map (owner, 23 Sep 2026).
  const financeOnly = role === 'manager'
    && (managerPerms.canRecordPayments || managerPerms.canClearCheques || managerPerms.canManageCollections)
    && !managerPerms.canManageAgreements && !managerPerms.canEditProperties && !managerPerms.canManageViewings && !managerPerms.canManageMaintenance;
  const permFiltered = role === 'manager'
    ? rawNav.filter(item => {
        if ('financeHidden' in item && item.financeHidden && financeOnly) return false;
        if (!('requirePerm' in item)) return true;
        const need = (item as { requirePerm?: string | string[] }).requirePerm ?? '';
        return (Array.isArray(need) ? need : [need]).some(f => managerPerms[f] === true);
      })
    : rawNav;
  // Drop any section header left with nothing under it. This runs for EVERY
  // role, not just managers: a section can be emptied by a withheld permission
  // *or* by parking all of its links with `hidden: true` — which is exactly
  // what happens to the admin's Service Provider section today.
  const sectionsKept = permFiltered.filter((item, i, arr) => {
    if (!('section' in item)) return true;
    for (let j = i + 1; j < arr.length; j++) {
      if ('section' in arr[j]) return false;   // next section → this one is empty
      if ('label' in arr[j]) return true;      // a visible link → keep header
    }
    return false;                              // trailing empty section
  });
  // …then collapse dividers the same filtering has stranded. Parking every link
  // between two rules leaves them drawn back-to-back with nothing in between,
  // which is exactly what the admin rail does now that only Risk sits there.
  const navItems = sectionsKept.reduce<NavItem[]>((acc, item) => {
    if ('divider' in item) {
      const prev = acc[acc.length - 1];
      if (!prev || 'divider' in prev) return acc;   // leading, or a repeat
    }
    acc.push(item);
    return acc;
  }, []);
  while (navItems.length && 'divider' in navItems[navItems.length - 1]) navItems.pop();
  const navHrefs = navItems.flatMap((it) => ('href' in it ? [it.href] : []));
  const { user, signOut } = useAuth();

  const displayName = buildDisplayName(user, 'User');
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <aside
      className={shell.rail}
      style={collapsed ? { width: 60, padding: '18px 8px', alignItems: 'center' } : undefined}
    >
      {/* Brand */}
      <Link
        href={withScope(dashboardPath(role))}
        className={shell.brand}
        style={collapsed ? { justifyContent: 'center', padding: '6px 0', gap: 0 } : undefined}
        title={collapsed ? 'UpNow' : undefined}
      >
        <span className={shell.brandMark}>U</span>
        {!collapsed && <span>UpNow</span>}
        {onClose && !collapsed && (
          <button
            onClick={(e) => { e.preventDefault(); onClose(); }}
            className="ml-auto lg:hidden"
            style={{ background: 'transparent', border: 0, color: '#8b968f', cursor: 'pointer' }}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        )}
      </Link>

      {/* Role chip — hidden when collapsed */}
      {!collapsed && <span className={shell.roleChip}>{ROLE_LABEL[role]}</span>}

      {/* Nav */}
      {/* The v32 tabs are filled blocks, so they get a little more air than the
          flat rails' 2px (owner, 4 Oct) — inline, the module serves every rail. */}
      <nav className={shell.nav} style={{ ...(OS_GROUPS[role] ? { gap: 6 } : null), ...(collapsed ? { alignItems: 'center' } : null) }}>
        {navItems.map((item, i) => {
          if ('divider' in item) {
            return <hr key={`divider-${i}`} className={shell.divider} style={collapsed ? { width: '100%' } : undefined} />;
          }
          if ('section' in item) {
            if (collapsed) return null;
            // The two v32 group headers carry a colour swatch matching their layer.
            const swatch = item.tone === 'shared'
              ? { background: '#0b563e' }
              : item.tone === 'pack'
                ? { background: '#bfe4d3', border: '1px solid #78b99b' }
                : null;
            return (
              <p key={`section-${i}`} className={shell.section} style={swatch ? { display: 'flex', alignItems: 'center', gap: 6 } : undefined}>
                {swatch && <span style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0, boxSizing: 'border-box', ...swatch }} />}
                {item.section}
              </p>
            );
          }
          const Icon = item.icon;

          if ('soon' in item && item.soon) {
            // A toned soon-item stays in its layer's colour, dimmed, so an
            // in-development tab (Business) reads as part of its own group.
            const soonTone: React.CSSProperties | undefined =
              item.tone === 'shared' ? { background: '#124e39', color: '#cfe1d9', opacity: 0.55 }
              : item.tone === 'pack' ? { background: '#e7f4ed', color: '#174c3a', border: '1px solid #cce7d9', opacity: 0.55 }
              : undefined;
            if (collapsed) {
              return (
                <div key={item.href} className={shell.itemSoon}
                  style={{ ...soonTone, justifyContent: 'center', padding: '8px', gap: 0 }}
                  title={`${item.label} — in development`}>
                  <span className={shell.glyph} style={item.tone ? { color: 'inherit' } : undefined}><Icon size={16} /></span>
                </div>
              );
            }
            return (
              <div key={item.href} className={shell.itemSoon} style={soonTone}>
                <span className={shell.glyph} style={item.tone ? { color: 'inherit' } : undefined}><Icon size={16} /></span>
                <span>{item.label}</span>
                <span className={shell.soonChip}>In development</span>
              </div>
            );
          }

          const overviewRoutes = [
            '/dashboard/customer', '/rental-provider/dashboard',
            '/dashboard/service-provider', '/dashboard/manager',
            '/dashboard/technician', '/dashboard/admin',
          ];
          const isOverview = overviewRoutes.includes(item.href);
          const onPath = (base: string) => pathname === base || pathname.startsWith(base + '/');
          // A query href (Calendar → /leads?view=calendar) is a VIEW of another
          // tab's page: it is active only when its params are all present, and
          // the plain-path tab of the same page (Demand → /leads) then yields.
          const [hrefPath, hrefQuery] = item.href.split('?');
          const queryMatches = (q: string) => q.split('&').every((kv) => {
            const [k, v] = kv.split('=');
            return navSearchParams.get(k) === v;
          });
          const siblingQueryActive = !hrefQuery && navHrefs.some((h) => {
            const [p, q] = h.split('?');
            return !!q && p === item.href && onPath(p) && queryMatches(q);
          });
          const matchesThis = onPath(hrefPath) || (item.match?.some(onPath) ?? false);
          // Most-specific wins: a parent (e.g. Settings) yields the highlight to a
          // deeper nav item nested under its href.
          const moreSpecific = navHrefs.some((h) => h !== item.href && h.startsWith(item.href + '/') && onPath(h));
          const isActive = hrefQuery
            ? onPath(hrefPath) && queryMatches(hrefQuery)
            : isOverview
              ? pathname === item.href && !siblingQueryActive
              : matchesThis && !moreSpecific && !siblingQueryActive;

          const badgeCount = item.badgeKey ? (counts[item.badgeKey] ?? 0) : 0;
          const hasBadge = badgeCount > 0;

          // v32 layer colours: dark green = shared OS, light green = Spaces pack.
          // Inline so they win over shell.item / shell.active without touching
          // the module used by every other rail.
          const toneStyle: React.CSSProperties | undefined =
            item.tone === 'shared'
              ? (isActive
                  ? { background: '#073b2b', color: '#fff', boxShadow: 'inset 0 0 0 2px #74c9a6', fontWeight: 600 }
                  : { background: '#124e39', color: '#e9f2ed' })
              : item.tone === 'pack'
                ? (isActive
                    ? { background: '#bfe4d3', color: '#164c39', border: '1px solid #68ae8c', fontWeight: 600 }
                    : { background: '#e7f4ed', color: '#174c3a', border: '1px solid #cce7d9' })
                : undefined;

          return (
            <Link
              key={item.href}
              href={withScope(item.href)}
              onClick={onClose}
              className={cn(shell.item, isActive && shell.active)}
              style={{ ...toneStyle, ...(collapsed ? { justifyContent: 'center', padding: '8px', gap: 0 } : null) }}
              title={collapsed ? (hasBadge ? `${item.label} (${badgeCount})` : item.label) : undefined}
            >
              <span className={shell.glyph} style={{ ...(item.tone ? { color: 'inherit' } : null), ...(collapsed && hasBadge ? { position: 'relative' } : null) }}>
                <Icon size={16} />
                {collapsed && hasBadge && (
                  <span style={{ position: 'absolute', top: -3, right: -4, width: 8, height: 8, borderRadius: 99, background: '#2e9f82', border: '1.5px solid #fff' }} />
                )}
              </span>
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && hasBadge && (
                <span
                  className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums leading-none"
                  style={{ background: '#2e9f82', color: '#fff' }}
                >
                  {badgeCount > 999 ? '999+' : badgeCount}
                </span>
              )}
              {!collapsed && isActive && !hasBadge && <ChevronRight size={14} className={shell.activeChevron} />}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div
        className={shell.user}
        style={collapsed ? { flexDirection: 'column', gap: 0, padding: '12px 0 4px' } : undefined}
      >
        <span className={shell.userAv} title={collapsed ? `${displayName} · ${user?.email ?? ''}` : undefined}>
          {initials}
        </span>
        {!collapsed && (
          <div className={shell.userMin}>
            <div className={shell.userName} title={displayName}>{displayName}</div>
            <div className={shell.userEmail} title={user?.email ?? ''}>{user?.email}</div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => { signOut(); }}
        className={shell.signOut}
        style={collapsed ? { justifyContent: 'center', padding: '8px', gap: 0 } : undefined}
        title={collapsed ? 'Sign out' : undefined}
      >
        <span className={shell.glyph}><LogOut size={16} /></span>
        {!collapsed && 'Sign out'}
      </button>
    </aside>
  );
}

/* ─────────────────────────────────────────────
   Customer avatar menu (topbar dropdown)
───────────────────────────────────────────── */
function CustomerAvatarMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const displayName = buildDisplayName(user, 'You');
  const initials = displayName.charAt(0).toUpperCase();

  const items: Array<{ label: string; href: string; icon: React.ElementType }> = [
    { label: 'Profile',         href: '/dashboard/customer/profile',       icon: UserCircle },
    { label: 'My Spaces',       href: '/dashboard/customer/spaces',        icon: BedDouble },
    { label: 'My Services',     href: '/dashboard/customer/services',      icon: Wrench },
    { label: 'Wishlist',        href: '/dashboard/customer/wishlist',      icon: Heart },
    { label: 'Notifications',   href: '/dashboard/customer/notifications', icon: Bell },
    { label: 'Help Center',     href: '/dashboard/customer/help',          icon: HelpCircle },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all"
        style={{ background: 'var(--color-primary)', color: '#fff' }}
        aria-label="User menu"
      >
        {initials}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-60 rounded-2xl bg-white shadow-xl z-30 overflow-hidden"
          style={{ border: '1px solid var(--color-base-200)' }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-base-200)' }}>
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>{displayName}</p>
            <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{user?.email}</p>
          </div>
          <nav className="py-1">
            {items.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--color-base-50,#fafafa)]"
                style={{ color: 'var(--color-neutral-700)' }}
              >
                <Icon size={16} style={{ color: 'var(--color-neutral-400)' }} />
                {label}
              </Link>
            ))}
            <hr className="my-1" style={{ borderColor: 'var(--color-base-200)' }} />
            <button
              onClick={() => { setOpen(false); signOut(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--color-base-50,#fafafa)]"
              style={{ color: 'var(--color-error, #dc2626)' }}
            >
              <LogOut size={16} />
              Logout
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   DashboardShell — main export
───────────────────────────────────────────── */
/** v32 preview: the in-page tab strip for the active OS group — the pages that
 *  fold into the selected rail tab (e.g. Portfolio → Properties · Units).
 *  Rendered by the shell between the topbar and the page so no page component
 *  changes; hidden when the group has one visible page. Tone-coloured like the
 *  rail: dark band for shared-OS groups, light band for Spaces-pack groups. */
function OsGroupTabs({ role, pathname, counts }: { role: UserRole; pathname: string; counts: NavCounts }) {
  const managerPerms = useManagerNavPerms(role);
  const waOn = useWhatsappEnabled(role);
  const tabsSearchParams = useSearchParams();
  const scopeRp = role === 'manager' ? tabsSearchParams.get('rp') : null;
  const withScope = (href: string) =>
    scopeRp && href.startsWith('/dashboard/manager') ? `${href}${href.includes('?') ? '&' : '?'}rp=${scopeRp}` : href;
  const groups = OS_GROUPS[role];
  if (!groups) return null;
  const onPath = (base: string) => pathname === base || pathname.startsWith(base + '/');
  // Most specific claim wins: /rental-provider/dashboard (Overview) would
  // prefix-match everything, so prefer the group whose matched base is longest.
  let active: OsGroup | undefined;
  let bestLen = -1;
  for (const g of groups) {
    for (const c of g.children) {
      for (const base of [c.href, ...(c.match ?? [])]) {
        if (onPath(base) && base.length > bestLen) { active = g; bestLen = base.length; }
      }
    }
  }
  if (!active) return null;
  const kids = visibleOsChildren(active, role, managerPerms, waOn, isFinanceOnly(role, managerPerms));
  if (kids.length < 2) return null;
  const shared = active.tone === 'shared';
  return (
    <div
      className="flex-shrink-0 flex items-center gap-1.5 px-5 py-2 border-b overflow-x-auto"
      style={{ background: shared ? '#124e39' : '#e7f4ed', borderColor: shared ? '#0b3f2c' : '#cce7d9' }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: shared ? '#8fc3a2' : '#527a66', marginRight: 8, whiteSpace: 'nowrap' }}>
        {active.label}
      </span>
      {kids.map((c) => {
        const isOn = onPath(c.href) || (c.match?.some(onPath) ?? false);
        const n = c.badgeKey ? (counts[c.badgeKey] ?? 0) : 0;
        return (
          <Link
            key={c.href}
            href={withScope(c.href)}
            className="inline-flex items-center gap-1.5 rounded-full whitespace-nowrap"
            style={{
              padding: '5px 12px', fontSize: 13, fontWeight: isOn ? 700 : 500,
              ...(shared
                ? (isOn ? { background: '#fff', color: '#0b3f2c' } : { color: '#d9ebe4' })
                : (isOn ? { background: '#124e39', color: '#fff' } : { color: '#174c3a' })),
            }}
          >
            {c.label}
            {n > 0 && (
              <span
                className="inline-flex items-center justify-center min-w-[18px] rounded-full tabular-nums leading-none"
                style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px',
                  background: isOn ? (shared ? '#e7f4ed' : 'rgba(255,255,255,.28)') : '#2e9f82',
                  color: isOn && shared ? '#124e39' : '#fff' }}
              >
                {n > 999 ? '999+' : n}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const spTier = useSpTier();
  const { user, loading, isAuthenticated, refresh, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const checkedAuthRef = useRef(false);
  // Sidebar count badges — safe before auth resolves (hook no-ops for non-RP / undefined role).
  const navCounts = useNavBadgeCounts(user?.role as UserRole);
  // SP onboarding: chromeless wizard (top header stays for layout); the page
  // signals when it hands over to Get Job-Ready and the sidebar returns.
  const [spOnboardingReady, setSpOnboardingReady] = useState(getSpOnboardingReady);
  useEffect(() => subscribeSpOnboardingReady(setSpOnboardingReady), []);

  useEffect(() => {
    const stored = localStorage.getItem('upnow_sidebar_collapsed');
    if (stored === 'true') setSidebarCollapsed(true);
  }, []);

  function toggleCollapse() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('upnow_sidebar_collapsed', String(next));
      return next;
    });
  }

  useEffect(() => {
    if (loading || user) return;
    if (!checkedAuthRef.current) {
      checkedAuthRef.current = true;
      void refresh().then((me) => {
        if (!me) router.replace('/');
      });
      return;
    }
    if (!isAuthenticated) {
      router.replace('/');
    }
  }, [loading, user, isAuthenticated, refresh, router]);

  // Lock html/body scroll so the only scroll surface is <main> inside this shell
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { htmlOverflow: html.style.overflow, htmlHeight: html.style.height, bodyOverflow: body.style.overflow, bodyHeight: body.style.height };
    html.style.overflow = 'hidden';
    html.style.height = '100%';
    body.style.overflow = 'hidden';
    body.style.height = '100%';
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.height = prev.htmlHeight;
      body.style.overflow = prev.bodyOverflow;
      body.style.height = prev.bodyHeight;
    };
  }, []);

  // Mailboxes are read when somebody arrives in the portal — not on a server timer.
  useEmailSyncOnLogin(loading || !user ? null : user.role);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-base-100)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  const role = user.role;

  // Hide the sidebar entirely on the onboarding page so it's a focused
  // full-screen flow (no nav to escape to before submitting).
  const hideSidebar =
    pathname?.endsWith('/rental-provider/dashboard/onboarding') ||
    (pathname?.endsWith('/service-provider/onboarding') && !spOnboardingReady);

  return (
    // `app-shell-root` is the hook the document dock insets so its rail never
    // covers the page it was opened from — see .doc-dock in globals.css.
    <div className="app-shell-root flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-base-100)', transition: 'padding 0.24s cubic-bezier(.22,.9,.3,1)' }}>
      {/* Desktop sidebar */}
      {!hideSidebar && (
        <div
          className="hidden lg:flex flex-shrink-0 h-full overflow-hidden"
          style={{ width: sidebarCollapsed ? 60 : 240, transition: 'width 0.2s ease' }}
        >
          <Sidebar role={role} pathname={pathname} collapsed={sidebarCollapsed} counts={navCounts} />
        </div>
      )}

      {/* Mobile sidebar overlay */}
      {!hideSidebar && sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full z-50" style={{ width: 240 }}>
            <Sidebar role={role} pathname={pathname} onClose={() => setSidebarOpen(false)} counts={navCounts} />
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar — hidden on pages that provide their own (e.g. onboarding) */}
        {!pathname?.endsWith('/rental-provider/dashboard/onboarding') && (
        <header
          className="flex-shrink-0 flex items-center justify-between px-5 h-14 border-b"
          style={{
            backgroundColor: '#fff',
            borderColor: 'var(--color-base-200)',
          }}
        >
          {/* Mobile hamburger */}
          {!hideSidebar && (
            <button
              className="lg:hidden text-[var(--color-neutral-700)] hover:text-[var(--color-neutral-900)]"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={22} />
            </button>
          )}

          {/* Chromeless mode (onboarding): the sidebar carries the brand, so
              the header takes it over — logo left, identity + exit right. */}
          {hideSidebar && (
            <span className="flex items-center gap-2">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ background: 'var(--color-primary)' }}
              >
                U
              </span>
              <span className="text-[15px] font-bold" style={{ color: 'var(--color-neutral-900)' }}>UpNow</span>
              <span
                className="ml-1 hidden rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:inline"
                style={{ background: 'var(--color-base-200)', color: 'var(--color-neutral-500)' }}
              >
                Provider setup
              </span>
            </span>
          )}

          {/* Desktop collapse/expand toggle */}
          {!hideSidebar && (
            <button
              className="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
              style={{ color: 'var(--color-neutral-500)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-base-100)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
              onClick={toggleCollapse}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          )}

          {hideSidebar ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-xs sm:block" style={{ color: 'var(--color-neutral-400)' }}>{user.email}</span>
              <button
                type="button"
                onClick={signOut}
                className="text-sm font-semibold underline underline-offset-2"
                style={{ color: 'var(--color-neutral-500)' }}
              >
                Sign out
              </button>
            </div>
          ) : (
          <div className="flex items-center gap-3">
            {/* KYC warning badge — only for roles that actually undergo KYC.
                Managers are invited sub-accounts and never do KYC; technicians DO
                (SP-131) but their state lives on technicians.compliance_status,
                surfaced on their own home screen — not on users.kyc_status. */}
            {['rental_provider', 'service_provider'].includes(role) && !(role === 'service_provider' && spTier === 'landlord_vendor') && user.kycStatus && !['verified', 'approved'].includes(user.kycStatus) && (
              <Link
                href={`${dashboardPath(role)}/documents`}
                className="hidden sm:flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
                style={{
                  backgroundColor: user.kycStatus === 'rejected' ? '#fef2f2' : user.kycStatus === 'pending_review' ? '#eff6ff' : '#fef3c7',
                  color: user.kycStatus === 'rejected' ? '#dc2626' : user.kycStatus === 'pending_review' ? '#1d4ed8' : '#92400e',
                }}
              >
                <AlertTriangle size={12} />
                {user.kycStatus === 'pending_review' ? 'KYC under review' : user.kycStatus === 'rejected' ? 'KYC rejected' : 'KYC required'}
              </Link>
            )}
            <NotificationBell />

            {/* Customer-only avatar dropdown with the full personal nav list */}
            {role === 'customer' && <CustomerAvatarMenu />}
          </div>
          )}
        </header>
        )}

        {/* v32 preview: the active group's pages as an in-page tab strip */}
        {!hideSidebar && <OsGroupTabs role={role} pathname={pathname} counts={navCounts} />}

        {/* Page content */}
        <main className={cn('flex-1 min-h-0 overflow-y-auto', shell.mainCanvas)}>
          {children}
        </main>
      </div>
    </div>
  );
}
