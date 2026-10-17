/**
 * UpNow OS workspace navigation — the provider rail in two sections (owner sketch, Oct 2026):
 *
 *   SHARED UPNOW OS (dark-green items, tone 'shared') — the same for every pack:
 *     Home · Demand · Communications · Calendar · Account Settings
 *   <VERTICAL> PACK (light-green items, tone 'vertical') — the active vertical's own work,
 *     switched with the pack selector in the rail. For Spaces:
 *     Overview · Portfolio · Operations · Tasks · Finance & Ledger · Business · Cases · Reports · Settings
 *
 *   Admin: a separate portal — Overview · Verification (Gate 1) · Vertical authorisation
 *   (Gate 2) · Listing approval (Gate 3) · People · Spaces · Services · Categories · Platform.
 *
 * Every existing route keeps a home here or a link from a page that is in the menu (parity
 * gate). The old Emails / WhatsApp pages and the two old calendars are no longer menu entries —
 * the unified Communications inbox and Calendar replace them — but their routes still work and
 * still light up the right workspace (`match` / hidden children).
 */
import type { UserRole } from '@/contexts/AuthContext';
import { verticalOf, type MsVerticalId } from '@/lib/catalog';
import { MODELS_OF, MODEL_INFO } from '@/lib/os/preview';

export type NavBadgeKey = 'leads' | 'properties' | 'units' | 'operations' | 'emails' | 'whatsapp';
export type NavTone = 'shared' | 'vertical';

export type OsChild = {
  label: string;
  /** Omitted for `soon` children. */
  href?: string;
  badgeKey?: NavBadgeKey;
  requirePerm?: string | string[];
  /** Extra path prefixes that also activate this child. */
  match?: string[];
  hidden?: true;
  /** Dropped for a finance-only manager. */
  financeHidden?: true;
  /** Designed, no backend yet — dimmed, never links. */
  soon?: true;
  /** Runs on preview data (no backend) — the rail marks it. */
  preview?: true;
  /** A non-link sub-heading row inside a workspace ("Long-term leases"). Dropped when
   *  nothing visible follows it before the next heading. */
  heading?: true;
};

export type OsGroup = {
  id: string;
  label: string;
  /** lucide icon name, resolved in OsRail (used by the collapsed rail). */
  icon: string;
  /** 'shared' = SHARED UPNOW OS section; 'vertical' = the <VERTICAL> PACK section. */
  tone: NavTone;
  badgeKey?: NavBadgeKey;
  children: OsChild[];
};

const R = '/rental-provider/dashboard';
const M = '/dashboard/manager';
const A = '/dashboard/admin';
const S = '/dashboard/service-provider';

/** A sub-heading row inside a workspace's children. */
const H = (label: string): OsChild => ({ label, heading: true });

// The Spaces booking models beside the lease board — no backend yet, they run on preview data.
const SPACES_MODEL_LABEL: Record<string, string> = {
  shortstay: 'Holiday homes', venue: 'Venues', court: 'Courts', charter: 'Yachts',
};
const modelKids = (v: MsVerticalId): OsChild[] =>
  MODELS_OF[v].map((m) => ({ label: SPACES_MODEL_LABEL[m] ?? MODEL_INFO[m].name, href: `${R}/v/${v}/${m}`, preview: true }));

// ---------------------------------------------------------------------------- rental provider

/** SHARED UPNOW OS — the same five workspaces whichever pack is active. */
const RP_SHARED: OsGroup[] = [
  { id: 'home', label: 'Home', icon: 'home', tone: 'shared', children: [
    { label: 'Home', href: R },
  ] },
  { id: 'demand', label: 'Demand', icon: 'trending', tone: 'shared', badgeKey: 'leads', children: [
    // ONE page for every lead: long-term leases + holiday homes, venues, courts, yachts (tabs inside).
    { label: 'All demand', href: `${R}/requests` },
    { label: 'Lease pipeline', href: `${R}/leads`, badgeKey: 'leads' },
    { label: 'Customers', href: `${R}/tenants` },
  ] },
  { id: 'communications', label: 'Communications', icon: 'message', tone: 'shared', children: [
    // Unified inbox: email + WhatsApp + booking messages + lead notes. The old Emails and
    // WhatsApp pages stay reachable from it and still light this workspace up.
    { label: 'Inbox', href: `${R}/inbox`, match: [`${R}/communications`, `${R}/whatsapp`] },
  ] },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', tone: 'shared', children: [
    // Every dated event in one calendar. The old viewings / bookings calendars still work.
    { label: 'Calendar', href: `${R}/calendar` },
    { label: 'Viewings calendar', href: `${R}/leads?view=calendar`, hidden: true },
  ] },
  { id: 'account', label: 'Account Settings', icon: 'account', tone: 'shared', children: [
    { label: 'Profile & verification', href: `${R}/profile` },
    { label: 'KYC documents', href: `${R}/documents` },
    { label: 'Team', href: `${R}/team` },
    { label: 'Vertical authorisations', href: `${R}/authorisations`, preview: true },
  ] },
];

/** SPACES PACK — the existing Spaces pages, regrouped and renamed. */
const SPACES_PACK: OsGroup[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge', tone: 'vertical', children: [
    { label: 'Overview', href: `${R}/v/spaces` },
  ] },
  { id: 'portfolio', label: 'Portfolio', icon: 'building', tone: 'vertical', children: [
    { label: 'Properties', href: `${R}/portfolio`, badgeKey: 'properties' },
    { label: 'Units & listings', href: `${R}/units`, badgeKey: 'units' },
    { label: 'Add units', href: `${R}/units/add` },
    { label: 'Booking listings', href: `${R}/v/spaces/listings`, preview: true },
    { label: 'Subcategory fields', href: `${R}/v/spaces/catalogue` },
  ] },
  { id: 'operations', label: 'Operations', icon: 'clipboard', tone: 'vertical', children: [
    H('Leases'),
    { label: 'Long-term leases', href: `${R}/orders`, match: [`${R}/contracts`] },
    { label: 'Ended leases', href: `${R}/ended-leases` },
    H('Bookings'),
    ...modelKids('spaces'),
    { label: 'Bookings calendar', href: `${R}/v/spaces/calendar`, hidden: true },
    H('Property care'),
    { label: 'Maintenance', href: `${R}/maintenance`, match: [`${R}/maintenance/`] },
    { label: 'Building inspections', href: `${R}/building-inspections`, match: [`${R}/building-inspections/`] },
    { label: 'AMC contracts', href: `${R}/amc`, match: [`${R}/amc/expenses`] },
  ] },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', tone: 'vertical', badgeKey: 'operations', children: [
    // The Today queue lives on Home; the Ops board is the task board.
    { label: 'Ops board', href: `${R}/operations`, badgeKey: 'operations' },
  ] },
  { id: 'finance', label: 'Finance & Ledger', icon: 'wallet', tone: 'vertical', children: [
    // Deposits are a tab inside Payments (/deposits redirects there).
    { label: 'Payments & deposits', href: `${R}/payments`, match: [`${R}/deposits`] },
    { label: 'Receivables', href: `${R}/receivables` },
  ] },
  { id: 'business', label: 'Business', icon: 'briefcase', tone: 'vertical', children: [
    { label: 'Vendors', href: `${R}/vendors` },
    { label: 'Templates', href: `${R}/templates` },
  ] },
  { id: 'cases', label: 'Cases', icon: 'scale', tone: 'vertical', children: [
    { label: 'Breaches', href: `${R}/breaches` },
    { label: 'Legal cases', href: `${R}/legal` },
  ] },
  { id: 'reports', label: 'Reports', icon: 'chart', tone: 'vertical', children: [
    { label: 'Reports', href: `${R}/reports`, match: [`${R}/reports/`] },
    { label: 'Analytics', href: `${R}/analytics`, hidden: true },
  ] },
  { id: 'settings', label: 'Settings', icon: 'settings', tone: 'vertical', children: [
    { label: 'Settings', href: `${R}/settings`, match: [`${R}/maintenance-list`, `${R}/restoration-list`, `${R}/amc/categories`] },
  ] },
];

/** SERVICES PACK for a landlord: the service work on their own buildings (real maintenance,
 *  vendor and AMC pages) and a read-only view of the public service catalogue. */
const SERVICES_PACK: OsGroup[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge', tone: 'vertical', children: [
    { label: 'Overview', href: `${R}/v/services` },
  ] },
  { id: 'operations', label: 'Operations', icon: 'clipboard', tone: 'vertical', children: [
    { label: 'Maintenance board', href: `${R}/operations?tab=maintenance` },
    { label: 'Maintenance requests', href: `${R}/maintenance`, match: [`${R}/maintenance/`] },
    { label: 'Vendors', href: `${R}/vendors`, match: [`${R}/vendors/`] },
    { label: 'AMC contracts', href: `${R}/amc`, match: [`${R}/amc/expenses`] },
    { label: 'Building inspections', href: `${R}/building-inspections`, match: [`${R}/building-inspections/`] },
  ] },
  { id: 'catalogue', label: 'Catalogue', icon: 'box', tone: 'vertical', children: [
    { label: 'Service catalogue', href: `${R}/v/services/catalogue` },
  ] },
];

/** Any other vertical's pack (preview data; Gate 2 lock until authorised). */
function otherPack(v: MsVerticalId): OsGroup[] {
  const label = verticalOf(v)?.label ?? v;
  return [
    { id: 'overview', label: 'Overview', icon: 'gauge', tone: 'vertical', children: [
      { label: 'Overview', href: `${R}/v/${v}` },
    ] },
    { id: 'operations', label: 'Operations', icon: 'clipboard', tone: 'vertical', children: [
      { label: 'Calendar', href: `${R}/v/${v}/calendar`, preview: true },
      ...modelKids(v),
    ] },
    { id: 'catalogue', label: 'Catalogue', icon: 'box', tone: 'vertical', children: [
      { label: `${label} offerings`, href: `${R}/v/${v}/catalogue`, preview: true },
      { label: 'Listings', href: `${R}/v/${v}/listings`, preview: true },
      { label: 'Create listing', href: `${R}/v/${v}/listings/new`, preview: true },
    ] },
  ];
}

const RENTAL_PROVIDER: OsGroup[] = [...RP_SHARED, ...SPACES_PACK];

// ---------------------------------------------------------------------------- manager

/** Asset manager: same two sections; always the Spaces pack (they act for landlords).
 *  Communications links to the existing Emails / WhatsApp pages and Calendar to the
 *  viewings calendar — no unified pages for the manager portal yet. */
const MANAGER: OsGroup[] = [
  { id: 'home', label: 'Home', icon: 'home', tone: 'shared', children: [
    { label: 'Home', href: M },
  ] },
  { id: 'demand', label: 'Demand', icon: 'trending', tone: 'shared', children: [
    { label: 'Lease pipeline', href: `${M}/leads`, requirePerm: 'canManageViewings', match: [`${M}/viewings`] },
    { label: 'Customers', href: `${M}/tenants`, requirePerm: 'canManageAgreements' },
  ] },
  { id: 'communications', label: 'Communications', icon: 'message', tone: 'shared', children: [
    { label: 'Emails', href: `${M}/communications`, requirePerm: 'canReadEmails' },
    { label: 'WhatsApp', href: `${M}/whatsapp`, requirePerm: 'canReadWhatsapp' },
  ] },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', tone: 'shared', children: [
    { label: 'Viewings calendar', href: `${M}/leads?view=calendar`, requirePerm: 'canManageViewings' },
  ] },
  { id: 'account', label: 'Account Settings', icon: 'account', tone: 'shared', children: [
    { label: 'My profile', href: `${M}/profile` },
  ] },
  { id: 'portfolio', label: 'Portfolio', icon: 'building', tone: 'vertical', children: [
    { label: 'Properties', href: `${M}/properties`, requirePerm: 'canListProperties', match: [`${M}/properties/`] },
    { label: 'Units & listings', href: `${M}/units`, requirePerm: 'canListProperties', financeHidden: true, match: [`${M}/units/`] },
  ] },
  { id: 'operations', label: 'Operations', icon: 'clipboard', tone: 'vertical', children: [
    H('Leases'),
    { label: 'Long-term leases', href: `${M}/contracts`, requirePerm: 'canManageAgreements' },
    { label: 'Ended leases', href: `${M}/ended-leases`, requirePerm: 'canManageAgreements' },
    H('Property care'),
    { label: 'Maintenance', href: `${M}/maintenance`, requirePerm: 'canManageMaintenance', match: [`${M}/maintenance/`] },
    { label: 'Building inspections', href: `${M}/building-inspections`, requirePerm: 'canManageInspections', match: [`${M}/building-inspections/`] },
    // Either flag opens AMC: the coordinator or the finance manager (0319).
    { label: 'AMC contracts', href: `${M}/amc`, requirePerm: ['canManageAmc', 'canRecordVendorPayments'], match: [`${M}/amc/expenses`] },
  ] },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', tone: 'vertical', children: [
    { label: 'Ops board', href: `${M}/operations`, requirePerm: 'canManageAgreements' },
  ] },
  { id: 'finance', label: 'Finance & Ledger', icon: 'wallet', tone: 'vertical', children: [
    { label: 'Payments & deposits', href: `${M}/payments`, requirePerm: 'canManageDeposits', match: [`${M}/deposits`] },
  ] },
  { id: 'business', label: 'Business', icon: 'briefcase', tone: 'vertical', children: [
    { label: 'Vendors', href: `${M}/vendors`, requirePerm: 'canManageVendors' },
    { label: 'Templates', href: `${M}/templates`, requirePerm: 'canManageTemplates' },
  ] },
  { id: 'cases', label: 'Cases', icon: 'scale', tone: 'vertical', children: [
    { label: 'Breaches', href: `${M}/breaches`, requirePerm: 'canManageLegal' },
    { label: 'Legal cases', href: `${M}/legal`, requirePerm: 'canManageLegal' },
  ] },
  { id: 'reports', label: 'Reports', icon: 'chart', tone: 'vertical', children: [
    { label: 'Reports', href: `${M}/reports`, requirePerm: 'canViewReports' },
    { label: 'Analytics', href: `${M}/analytics`, requirePerm: 'canViewReports', hidden: true },
  ] },
  { id: 'settings', label: 'Settings', icon: 'settings', tone: 'vertical', children: [
    // Delegated lists (maintenance coverage, restoration, AMC categories) — not for finance-only.
    { label: 'Settings', href: `${M}/settings`, financeHidden: true, match: [`${M}/maintenance-coverage`, `${M}/maintenance-list`, `${M}/restoration-list`, `${M}/amc/categories`] },
  ] },
];

// ---------------------------------------------------------------------------- service provider

/**
 * Service provider (home services): the shared section over its real pages + the SERVICES
 * PACK. Demand and Operations are two views of the one booking board (/operations): Requests
 * + Quotes lanes are demand, Active + Closure the work. `requirePerm: 'spSetupOpen'` = shown
 * only while the account is not yet approved. There is no SP messaging page, so the SP rail
 * has no Communications entry.
 */
const SERVICE_PROVIDER: OsGroup[] = [
  { id: 'home', label: 'Home', icon: 'home', tone: 'shared', children: [
    { label: 'Home', href: S },
  ] },
  { id: 'demand', label: 'Demand', icon: 'trending', tone: 'shared', children: [
    { label: 'Job requests', href: `${S}/operations?tab=requests` },
    { label: 'Quotes', href: `${S}/operations?tab=quotes` },
  ] },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', tone: 'shared', children: [
    { label: 'Schedule & shifts', href: `${S}/schedule` },
  ] },
  { id: 'account', label: 'Account Settings', icon: 'account', tone: 'shared', children: [
    { label: 'Business profile', href: `${S}/settings?tab=profile`, match: [`${S}/profile`] },
    { label: 'Documents & verification', href: `${S}/documents` },
    { label: 'Team & technicians', href: `${S}/settings?tab=team`, match: [`${S}/team`] },
    { label: 'Onboarding', href: `${S}/onboarding`, requirePerm: 'spSetupOpen' },
  ] },
  { id: 'operations', label: 'Operations', icon: 'clipboard', tone: 'vertical', children: [
    // The booking board (Active + Closure lanes); /jobs redirects here, /jobs/[id] is a card.
    { label: 'Dispatch board', href: `${S}/operations`, match: [`${S}/jobs`] },
    // Jobs a landlord runs from their own page — no booking, so never on the board.
    { label: 'My jobs', href: `${S}/my-jobs` },
    { label: 'Live map', href: `${S}/live` },
  ] },
  { id: 'catalogue', label: 'Catalogue', icon: 'box', tone: 'vertical', children: [
    { label: 'Services & pricing', href: `${S}/services` },
    { label: 'Add service', href: `${S}/services/new` },
  ] },
  { id: 'finance', label: 'Finance & Ledger', icon: 'wallet', tone: 'vertical', children: [
    { label: 'Earnings & payouts', href: `${S}/earnings` },
  ] },
  { id: 'reports', label: 'Reviews', icon: 'chart', tone: 'vertical', children: [
    { label: 'Reviews', href: `${S}/reviews` },
  ] },
  { id: 'settings', label: 'Settings', icon: 'settings', tone: 'vertical', children: [
    { label: 'Settings', href: `${S}/settings` },
    { label: 'Job rules & readiness', href: `${S}/settings?tab=rules`, match: [`${S}/job-ready`] },
  ] },
];

const ADMIN: OsGroup[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge', tone: 'shared', children: [
    { label: 'Platform pulse', href: A, match: [`${A}/pulse`] },
    { label: 'Platform overview', href: `${A}/overview` },
    { label: 'Activity', href: `${A}/activity`, hidden: true },
  ] },
  { id: 'verification', label: 'Verification', icon: 'shield', tone: 'shared', children: [
    // Gate 1 — business verification (KYC queue, split panel).
    { label: 'Profile verification', href: `${A}/kyc`, match: [`${A}/kyc/`] },
  ] },
  { id: 'authorisation', label: 'Vertical authorisation', icon: 'lock', tone: 'shared', children: [
    // Gate 2 — no backend yet; runs on preview data.
    { label: 'Authorisation queue', href: `${A}/authorisation`, preview: true },
  ] },
  { id: 'listings', label: 'Listing approval', icon: 'check', tone: 'shared', children: [
    // Gate 3 — one approval surface per live vertical.
    { label: 'Spaces listings', href: `${A}/listings/rental-providers`, match: [`${A}/listings`] },
    { label: 'Services listings', href: `${A}/listings/service-providers` },
  ] },
  { id: 'people', label: 'People', icon: 'users', tone: 'shared', children: [
    { label: 'User management', href: `${A}/users`, match: [`${A}/users/`] },
    { label: 'Team oversight', href: `${A}/team` },
    { label: 'Admin accounts', href: `${A}/accounts`, match: [`${A}/accounts/`] },
  ] },
  { id: 'spaces', label: 'Spaces', icon: 'building', tone: 'vertical', children: [
    { label: 'Properties', href: `${A}/properties`, match: [`${A}/properties/`] },
    { label: 'Units', href: `${A}/units`, match: [`${A}/units/`] },
    { label: 'Platform billing', href: `${A}/billing` },
  ] },
  { id: 'services', label: 'Services', icon: 'wrench', tone: 'vertical', children: [
    { label: 'Dispatch', href: `${A}/operations`, match: [`${A}/operations/`] },
    { label: 'Reviews', href: `${A}/reviews` },
    { label: 'Payouts', href: `${A}/payouts` },
    { label: 'Disputes', href: `${A}/disputes` },
  ] },
  { id: 'categories', label: 'Categories', icon: 'layers', tone: 'shared', children: [
    { label: 'Verticals & subcategories', href: `${A}/categories` },
    { label: 'Service catalog', href: `${A}/catalog` },
  ] },
  { id: 'platform', label: 'Platform', icon: 'settings', tone: 'shared', children: [
    { label: 'Platform agreement', href: `${A}/agreements` },
    { label: 'Jurisdiction', href: `${A}/legal` },
    { label: 'Platform status', href: `${A}/status` },
    { label: 'Audit history', href: `${A}/audit`, preview: true },
    { label: 'Analytics', href: `${A}/analytics`, hidden: true },
    { label: 'Risk', href: `${A}/risk`, hidden: true },
    { label: 'Inbox', href: `${A}/inbox`, hidden: true },
  ] },
];


/** The pack groups for a rental provider's active vertical. */
export function packGroups(v: MsVerticalId): OsGroup[] {
  if (v === 'spaces') return SPACES_PACK;
  if (v === 'services') return SERVICES_PACK;
  return otherPack(v);
}

/** Workspaces for a role, scoped to the active vertical (rental providers only). */
export function workspacesFor(role: UserRole, vertical: MsVerticalId = 'spaces'): OsGroup[] {
  if (role === 'rental_provider') return [...RP_SHARED, ...packGroups(vertical)];
  return OS_WORKSPACES[role] ?? [];
}

export const OS_WORKSPACES: Partial<Record<UserRole, OsGroup[]>> = {
  rental_provider: RENTAL_PROVIDER,
  manager: MANAGER,
  service_provider: SERVICE_PROVIDER,
  admin: ADMIN,
  super_admin: ADMIN,
};

/** Roles that get the Genspark OS shell. */
export const isOsRole = (role: UserRole) => role in OS_WORKSPACES;
export const isAdminRole = (role: UserRole) => role === 'admin' || role === 'super_admin';

/** Finance-only = holds a money flag and none of the working flags (owner, 23 Sep 2026). */
export function isFinanceOnly(role: UserRole, perms: Record<string, boolean>): boolean {
  return role === 'manager'
    && !!(perms.canRecordPayments || perms.canClearCheques || perms.canManageCollections)
    && !perms.canManageAgreements && !perms.canEditProperties && !perms.canManageViewings && !perms.canManageMaintenance;
}

/** Children this user can see: parked entries drop, WhatsApp drops without a bridge, and
 *  the manager permission gates + finance-only carve-out apply per child. */
export function visibleChildren(
  group: OsGroup, role: UserRole, perms: Record<string, boolean>, waOn: boolean,
): OsChild[] {
  const financeOnly = isFinanceOnly(role, perms);
  const kept = group.children.filter((c) => {
    if (c.hidden) return false;
    if (c.heading || c.soon) return true;
    if (!waOn && c.href?.endsWith('/whatsapp')) return false;
    if (role === 'manager' && c.financeHidden && financeOnly) return false;
    // Manager permission gates; for a service provider, account-state flags (spSetupOpen).
    if ((role === 'manager' || role === 'service_provider') && c.requirePerm) {
      const need = Array.isArray(c.requirePerm) ? c.requirePerm : [c.requirePerm];
      if (!need.some((f) => perms[f] === true)) return false;
    }
    return true;
  });
  // A sub-heading with nothing under it (before the next heading) drops out.
  return kept.filter((c, i) => !c.heading || (i + 1 < kept.length && !kept[i + 1].heading));
}

/** Path-level match: exact, or a sub-path. */
export const onPath = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + '/');

/**
 * The single active child for this URL — the most specific claim wins, so the Overview
 * root (a prefix of everything) only wins when nothing else matches. Query hrefs
 * (Calendar → /leads?view=calendar) win over their plain sibling when the query matches.
 */
export function activeChild(
  groups: OsGroup[], pathname: string, search: URLSearchParams,
): { group: OsGroup; child: OsChild } | null {
  let best: { group: OsGroup; child: OsChild; score: number } | null = null;
  for (const g of groups) {
    for (const c of g.children) {
      if (!c.href) continue;
      const [path, query] = c.href.split('?');
      const queryOk = !query || query.split('&').every((kv) => {
        const [k, v] = kv.split('=');
        return search.get(k) === v;
      });
      if (!queryOk) continue;
      for (const base of [path, ...(c.match ?? [])]) {
        const hit = base === path && isRootHref(path) ? pathname === path : onPath(pathname, base);
        // +0.5 for a matching query so Calendar beats Leads on /leads?view=calendar.
        const score = hit ? base.length + (query ? 0.5 : 0) : -1;
        if (score > (best?.score ?? -1)) best = { group: g, child: c, score };
      }
    }
  }
  return best ? { group: best.group, child: best.child } : null;
}

const ROOTS = new Set([R, M, A, S]);
const isRootHref = (p: string) => ROOTS.has(p);
