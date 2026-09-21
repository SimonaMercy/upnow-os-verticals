'use client';

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Home, Search, Building2, FileText, CalendarCheck, Wrench, Users, Star, Wallet, BookOpen, Bell, Settings, LogOut, Menu, X, ChevronRight, ChevronLeft, ShieldCheck, ShieldAlert, BarChart2, AlertTriangle, Inbox, Briefcase, UserCircle, TrendingUp, UserCheck, Mail, Receipt, BedDouble, Heart, HelpCircle, Archive, ClipboardList, SlidersHorizontal, LineChart, Activity, Gauge, FileSignature, HeartPulse, MapPin, Scale, MessageCircle } from 'lucide-react';
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

type NavItem =
  // `match` lists extra path prefixes that also activate the item — for sections
  // whose detail pages live under a different route than the nav href (e.g. the
  // Leases list is /orders but a lease opens at /contracts/:id/v2).
  // `hidden` parks a section: the entry stays here (route, icon, position) but
  // is dropped from the rail. See the HIDDEN note below.
  | { label: string; href: string; icon: React.ElementType; soon?: boolean; requirePerm?: string; badgeKey?: NavBadgeKey; match?: string[]; hidden?: true }
  | { divider: true }
  | { section: string };

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
  { label: 'Jobs',        href: '/dashboard/service-provider/operations', icon: ClipboardList, match: ['/dashboard/service-provider/jobs', '/dashboard/service-provider'] },
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
  rental_provider: [
    { label: 'Dashboard',        href: '/rental-provider/dashboard',                icon: LayoutDashboard },
    { label: 'Leads',            href: '/rental-provider/dashboard/leads',          icon: TrendingUp, badgeKey: 'leads' },
    { label: 'Properties',       href: '/rental-provider/dashboard/portfolio',      icon: Building2, badgeKey: 'properties' },
    { label: 'Units',            href: '/rental-provider/dashboard/units',          icon: Home, badgeKey: 'units' },
    { label: 'Customers',        href: '/rental-provider/dashboard/tenants',        icon: UserCheck },
    { label: 'Payments',         href: '/rental-provider/dashboard/payments',       icon: Wallet, match: ['/rental-provider/dashboard/deposits'] },
    { label: 'Operations',       href: '/rental-provider/dashboard/operations',     icon: ClipboardList, badgeKey: 'operations' },
    // No badge on Leases. The register carries several figures of its own
    // (fully set up, starts later, expired) and a single number in the nav could
    // only ever be one of them — which read as a contradiction against the page.
    // Operations keeps its badge: that one IS a worklist length, a single fact.
    { label: 'Leases',           href: '/rental-provider/dashboard/orders',         icon: FileText, match: ['/rental-provider/dashboard/contracts'] },
    { label: 'Ended Leases',     href: '/rental-provider/dashboard/ended-leases',   icon: Archive },
    { divider: true },
    // v2: maintenance is a first-class section — the request worklist, the item
    // catalogue, and the landlord's own vendor roster (which also highlights for
    // the AMC contracts page until that folds in fully).
    { section: 'Maintenance' },
    { label: 'Requests',         href: '/rental-provider/dashboard/maintenance',      icon: ClipboardList, match: ['/rental-provider/dashboard/maintenance/'] },
    { label: 'Vendors',          href: '/rental-provider/dashboard/vendors',          icon: Users },
    // AMC contracts — destined to fold into the vendor pages as the
    // commitments layer lands; until then it lives here under Maintenance.
    { label: 'AMC',              href: '/rental-provider/dashboard/amc',              icon: FileSignature },
    { divider: true },
    // Legal & breach management — the disputes register (spec 2026-09-14);
    // breaches themselves live on the lease page and the Operations boards.
    { section: 'Legal' },
    // Two pipelines, two pages (owner, 14 Sep: "keep breaches and Legal separate — separate pages").
    { label: 'Breaches',         href: '/rental-provider/dashboard/breaches',         icon: ShieldAlert, match: ['/rental-provider/dashboard/breaches'] },
    { label: 'Legal',            href: '/rental-provider/dashboard/legal',            icon: Scale, match: ['/rental-provider/dashboard/legal'] },
    { divider: true },
    { section: 'More' },
    { label: 'Templates',        href: '/rental-provider/dashboard/templates',      icon: BookOpen },
    // Un-parked 17 Sep: the page is now the landlord's email inbox (their own
    // mailbox, Settings → Email). The badge is unread replies.
    { label: 'Emails',           href: '/rental-provider/dashboard/communications', icon: Mail, badgeKey: 'emails' },
    { label: 'WhatsApp',         href: '/rental-provider/dashboard/whatsapp',       icon: MessageCircle, badgeKey: 'whatsapp' },
    { label: 'Reports',          href: '/rental-provider/dashboard/reports',        icon: BarChart2 },
    { label: 'Analytics',        href: '/rental-provider/dashboard/analytics',      icon: LineChart, hidden: true },
    // What the managers are doing — the visual overview built on the activity
    // log. Sits directly above Settings, where the team is administered.
    // LANDLORD-ONLY: the manager rail has no counterpart, and the API refuses a
    // manager outright (see ReportsController's team-overview routes).
    { label: 'Team',             href: '/rental-provider/dashboard/team',           icon: Users },
    { divider: true },
    // Profile OUT of Settings; Maintenance List / Restoration List / AMC categories IN (owner, 12 Sep).
    { label: 'My Profile',       href: '/rental-provider/dashboard/profile',        icon: UserCircle },
    { label: 'Settings',         href: '/rental-provider/dashboard/settings',       icon: Settings, match: ['/rental-provider/dashboard/maintenance-list', '/rental-provider/dashboard/restoration-list', '/rental-provider/dashboard/amc/categories'] },
  ],
  service_provider: [
    // Onboarding, Team and Documents intentionally have no nav entries:
    // onboarding is where the gate sends unapproved accounts, Team lives in
    // Settings → Team, Documents in Settings → Profile. Jobs has none either:
    // Operations IS the job board; /jobs now redirects there and /jobs/[id]
    // (the job detail) is reached by opening a card.
    { label: 'Overview',         href: '/dashboard/service-provider',            icon: LayoutDashboard },
    { label: 'Operations',       href: '/dashboard/service-provider/operations', icon: ClipboardList, match: ['/dashboard/service-provider/jobs'] },
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
  manager: [
    { label: 'Overview',         href: '/dashboard/manager',            icon: LayoutDashboard },
    { label: 'Leads',            href: '/dashboard/manager/leads',   icon: TrendingUp, requirePerm: 'canManageViewings', match: ['/dashboard/manager/viewings'] },
    { label: 'Properties',       href: '/dashboard/manager/properties', icon: Building2, requirePerm: 'canListProperties' },
    { label: 'Units',            href: '/dashboard/manager/units',      icon: Home, requirePerm: 'canListProperties' },
    { label: 'Customers',        href: '/dashboard/manager/tenants',    icon: UserCheck, requirePerm: 'canManageAgreements' },
    { label: 'Payments',         href: '/dashboard/manager/payments',  icon: Wallet,  requirePerm: 'canManageDeposits', match: ['/dashboard/manager/deposits'] },
    { label: 'Operations',       href: '/dashboard/manager/operations', icon: ClipboardList, requirePerm: 'canManageAgreements' },
    { label: 'Leases',           href: '/dashboard/manager/contracts',  icon: FileText,  requirePerm: 'canManageAgreements' },
    { label: 'Ended Leases',     href: '/dashboard/manager/ended-leases', icon: Archive, requirePerm: 'canManageAgreements' },
    { divider: true },
    // Mirrors the landlord rail's Maintenance section; the header drops on its
    // own when canManageMaintenance empties it (see sectionsKept).
    { section: 'Maintenance' },
    { label: 'Requests',         href: '/dashboard/manager/maintenance',      icon: ClipboardList, requirePerm: 'canManageMaintenance', match: ['/dashboard/manager/maintenance/'] },
    { label: 'Vendors',          href: '/dashboard/manager/vendors',          icon: Users, requirePerm: 'canManageVendors' },
    { label: 'AMC',              href: '/dashboard/manager/amc',              icon: FileSignature, requirePerm: 'canManageAmc' },
    { divider: true },
    { section: 'Legal' },
    { label: 'Breaches',         href: '/dashboard/manager/breaches',         icon: ShieldAlert, requirePerm: 'canManageLegal', match: ['/dashboard/manager/breaches'] },
    { label: 'Legal',            href: '/dashboard/manager/legal',            icon: Scale, requirePerm: 'canManageLegal', match: ['/dashboard/manager/legal'] },
    { divider: true },
    { section: 'More' },
    { label: 'Templates',        href: '/dashboard/manager/templates',  icon: BookOpen, requirePerm: 'canManageTemplates' },
    { label: 'Emails',           href: '/dashboard/manager/communications', icon: Mail, requirePerm: 'canReadEmails' },
    { label: 'WhatsApp',         href: '/dashboard/manager/whatsapp',       icon: MessageCircle, requirePerm: 'canReadWhatsapp' },
    { label: 'Reports',          href: '/dashboard/manager/reports',    icon: BarChart2, requirePerm: 'canViewReports' },
    { label: 'Analytics',        href: '/dashboard/manager/analytics',  icon: LineChart, requirePerm: 'canViewReports', hidden: true },
    { label: 'My Profile',       href: '/dashboard/manager/profile',    icon: UserCircle },
    // The lists moved under Settings (owner, 12 Sep) — the page shows only what the landlord delegated.
    { label: 'Settings',         href: '/dashboard/manager/settings',   icon: Settings, match: ['/dashboard/manager/maintenance-coverage', '/dashboard/manager/maintenance-list', '/dashboard/manager/restoration-list', '/dashboard/manager/amc/categories'] },
  ],
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
    scopeRp && href.startsWith('/dashboard/manager') ? `${href}?rp=${scopeRp}` : href;
  // Parked sections (see the HIDDEN note on NAV) drop out for every role, ahead
  // of the manager permission filter so an emptied section header still goes.
  // The onboarding gate stamps the SP tier (sessionStorage + an 'sp-tier'
  // event, since the stamp lands AFTER this shell first renders); a light
  // vendor gets its own nav.
  const spTier = useSpTier();
  const baseNav = role === 'service_provider' && spTier === 'landlord_vendor' ? SP_LIGHT_NAV : (NAV[role] ?? []);
  // WhatsApp has no entry where the environment has no bridge to run it through.
  const rawNav = baseNav.filter(item => !('hidden' in item && item.hidden))
    .filter(item => waOn || !('href' in item && typeof item.href === 'string' && item.href.endsWith('/whatsapp')));
  // For managers: hide nav items whose requirePerm flag isn't granted, then drop
  // any section header left with no visible links under it (so a landlord that
  // withholds, say, all Finance permissions doesn't leave an empty "Finance").
  const permFiltered = role === 'manager'
    ? rawNav.filter(item => {
        if (!('requirePerm' in item)) return true;
        return managerPerms[(item as { requirePerm?: string }).requirePerm ?? ''] === true;
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
      <nav className={shell.nav} style={collapsed ? { alignItems: 'center' } : undefined}>
        {navItems.map((item, i) => {
          if ('divider' in item) {
            return <hr key={`divider-${i}`} className={shell.divider} style={collapsed ? { width: '100%' } : undefined} />;
          }
          if ('section' in item) {
            if (collapsed) return null;
            return <p key={`section-${i}`} className={shell.section}>{item.section}</p>;
          }
          const Icon = item.icon;

          if ('soon' in item && item.soon) {
            if (collapsed) {
              return (
                <div key={item.href} className={shell.itemSoon}
                  style={{ justifyContent: 'center', padding: '8px', gap: 0 }}
                  title={item.label}>
                  <span className={shell.glyph}><Icon size={16} /></span>
                </div>
              );
            }
            return (
              <div key={item.href} className={shell.itemSoon}>
                <span className={shell.glyph}><Icon size={16} /></span>
                <span>{item.label}</span>
                <span className={shell.soonChip}>Soon</span>
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
          const matchesThis = onPath(item.href) || (item.match?.some(onPath) ?? false);
          // Most-specific wins: a parent (e.g. Settings) yields the highlight to a
          // deeper nav item nested under its href.
          const moreSpecific = navHrefs.some((h) => h !== item.href && h.startsWith(item.href + '/') && onPath(h));
          const isActive = isOverview
            ? pathname === item.href
            : matchesThis && !moreSpecific;

          const badgeCount = item.badgeKey ? (counts[item.badgeKey] ?? 0) : 0;
          const hasBadge = badgeCount > 0;

          return (
            <Link
              key={item.href}
              href={withScope(item.href)}
              onClick={onClose}
              className={cn(shell.item, isActive && shell.active)}
              style={collapsed ? { justifyContent: 'center', padding: '8px', gap: 0 } : undefined}
              title={collapsed ? (hasBadge ? `${item.label} (${badgeCount})` : item.label) : undefined}
            >
              <span className={shell.glyph} style={collapsed && hasBadge ? { position: 'relative' } : undefined}>
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

        {/* Page content */}
        <main className={cn('flex-1 min-h-0 overflow-y-auto', shell.mainCanvas)}>
          {children}
        </main>
      </div>
    </div>
  );
}
