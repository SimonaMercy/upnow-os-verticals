/**
 * UpNow OS workspace navigation — the approved Genspark Stage 2 structure applied to the
 * real dashboards.
 *
 *   Provider (rental provider / manager / service provider): 8 workspaces — Overview · Demand · Operations ·
 *   Catalogue · Finance · Business · Insights · Settings. Operations and Catalogue are the
 *   vertical-scoped workspaces; the rest are shared.
 *   Admin: a separate portal — Overview · Verification (Gate 1) · Vertical authorisation
 *   (Gate 2) · Listing approval (Gate 3) · People · Spaces · Services · Categories · Platform.
 *
 * Every existing route keeps exactly one home here (parity gate). Children marked `soon`
 * are workflows the Genspark design calls for that have no backend yet (short-stay
 * bookings, venue/court/charter boards, vertical authorisation). They render dimmed with a
 * "Soon" chip and never link — no page pretends to work.
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
  /** lucide icon name, resolved in OsRail. */
  icon: string;
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

// The Spaces operating models the Genspark design adds beside the lease board. No backend
// yet — they run on preview data (src/lib/os/preview) and say so on the page.
const modelKids = (v: MsVerticalId): OsChild[] =>
  MODELS_OF[v].map((m) => ({ label: MODEL_INFO[m].name, href: `${R}/v/${v}/${m}`, preview: true }));

const RENTAL_PROVIDER: OsGroup[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge', tone: 'shared', children: [
    { label: 'Overview', href: R },
  ] },
  { id: 'demand', label: 'Demand', icon: 'trending', tone: 'shared', badgeKey: 'leads', children: [
    H('Long-term leasing'),
    // Long-term rental pipeline (real API).
    { label: 'Leads & enquiries', href: `${R}/leads`, badgeKey: 'leads' },
    { label: 'Customers', href: `${R}/tenants` },
    H('All demand — leases + bookings'),
    // ONE inbox: long-term leads (read-only, live) + short stays, venues, courts, yachts (preview engine).
    { label: 'All demand', href: `${R}/requests`, preview: true },
    H('Inbox'),
    { label: 'Emails', href: `${R}/communications`, badgeKey: 'emails' },
    { label: 'WhatsApp', href: `${R}/whatsapp`, badgeKey: 'whatsapp' },
  ] },
  { id: 'operations', label: 'Operations', icon: 'calendar', tone: 'vertical', badgeKey: 'operations', children: [
    // Two operating families, each under its own sub-heading so the menu never reads as one
    // jumbled list: the long-term lease lifecycle (real API) and the booking models (preview).
    H('Long-term leases'),
    // The lead/viewing calendar is a view of the Leads page.
    { label: 'Viewings calendar', href: `${R}/leads?view=calendar` },
    { label: 'Long-term leases', href: `${R}/orders`, match: [`${R}/contracts`] },
    { label: 'Ended leases', href: `${R}/ended-leases` },
    { label: 'Ops board', href: `${R}/operations`, badgeKey: 'operations' },
    { label: 'Maintenance', href: `${R}/maintenance`, match: [`${R}/maintenance/`] },
    { label: 'Building inspections', href: `${R}/building-inspections`, match: [`${R}/building-inspections/`] },
    { label: 'AMC contracts', href: `${R}/amc`, match: [`${R}/amc/expenses`] },
    { label: 'Breaches', href: `${R}/breaches` },
    { label: 'Legal cases', href: `${R}/legal` },
    H('Bookings — stays, venues, courts, yachts'),
    // Calendar of short-stay / venue / court / yacht bookings (preview engine).
    { label: 'Bookings calendar', href: `${R}/v/spaces/calendar`, preview: true },
    ...modelKids('spaces'),
  ] },
  { id: 'catalogue', label: 'Catalogue', icon: 'box', tone: 'vertical', children: [
    { label: 'Properties', href: `${R}/portfolio`, badgeKey: 'properties' },
    { label: 'Units & listings', href: `${R}/units`, badgeKey: 'units' },
    { label: 'Add units', href: `${R}/units/add` },
    { label: 'Subcategory fields', href: `${R}/v/spaces/catalogue` },
  ] },
  { id: 'finance', label: 'Finance', icon: 'wallet', tone: 'shared', children: [
    // Deposits are a tab inside Payments (/deposits redirects there).
    { label: 'Payments & deposits', href: `${R}/payments`, match: [`${R}/deposits`] },
    { label: 'Receivables', href: `${R}/receivables` },
  ] },
  { id: 'business', label: 'Business', icon: 'building', tone: 'shared', children: [
    { label: 'Profile & verification', href: `${R}/profile` },
    { label: 'KYC documents', href: `${R}/documents` },
    { label: 'Vertical authorisations', href: `${R}/authorisations`, preview: true },
    { label: 'Team', href: `${R}/team` },
    { label: 'Vendors', href: `${R}/vendors` },
  ] },
  { id: 'insights', label: 'Insights', icon: 'chart', tone: 'shared', children: [
    { label: 'Reports', href: `${R}/reports`, match: [`${R}/reports/`] },
    { label: 'Analytics', href: `${R}/analytics`, hidden: true },
  ] },
  { id: 'settings', label: 'Settings', icon: 'settings', tone: 'shared', children: [
    { label: 'Settings', href: `${R}/settings`, match: [`${R}/maintenance-list`, `${R}/restoration-list`, `${R}/amc/categories`] },
    { label: 'Templates', href: `${R}/templates` },
  ] },
];

const MANAGER: OsGroup[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge', tone: 'shared', children: [
    { label: 'Overview', href: M },
  ] },
  { id: 'demand', label: 'Demand', icon: 'trending', tone: 'shared', children: [
    { label: 'Leads & enquiries', href: `${M}/leads`, requirePerm: 'canManageViewings', match: [`${M}/viewings`] },
    { label: 'Customers', href: `${M}/tenants`, requirePerm: 'canManageAgreements' },
    { label: 'Emails', href: `${M}/communications`, requirePerm: 'canReadEmails' },
    { label: 'WhatsApp', href: `${M}/whatsapp`, requirePerm: 'canReadWhatsapp' },
  ] },
  { id: 'operations', label: 'Operations', icon: 'calendar', tone: 'vertical', children: [
    { label: 'Calendar', href: `${M}/leads?view=calendar`, requirePerm: 'canManageViewings' },
    { label: 'Long-term leases', href: `${M}/contracts`, requirePerm: 'canManageAgreements' },
    { label: 'Ended leases', href: `${M}/ended-leases`, requirePerm: 'canManageAgreements' },
    { label: 'Ops board', href: `${M}/operations`, requirePerm: 'canManageAgreements' },
    { label: 'Maintenance', href: `${M}/maintenance`, requirePerm: 'canManageMaintenance', match: [`${M}/maintenance/`] },
    { label: 'Building inspections', href: `${M}/building-inspections`, requirePerm: 'canManageInspections', match: [`${M}/building-inspections/`] },
    // Either flag opens AMC: the coordinator or the finance manager (0319).
    { label: 'AMC contracts', href: `${M}/amc`, requirePerm: ['canManageAmc', 'canRecordVendorPayments'], match: [`${M}/amc/expenses`] },
    { label: 'Breaches', href: `${M}/breaches`, requirePerm: 'canManageLegal' },
    { label: 'Legal cases', href: `${M}/legal`, requirePerm: 'canManageLegal' },
  ] },
  { id: 'catalogue', label: 'Catalogue', icon: 'box', tone: 'vertical', children: [
    { label: 'Properties', href: `${M}/properties`, requirePerm: 'canListProperties', match: [`${M}/properties/`] },
    { label: 'Units & listings', href: `${M}/units`, requirePerm: 'canListProperties', financeHidden: true, match: [`${M}/units/`] },
  ] },
  { id: 'finance', label: 'Finance', icon: 'wallet', tone: 'shared', children: [
    { label: 'Payments & deposits', href: `${M}/payments`, requirePerm: 'canManageDeposits', match: [`${M}/deposits`] },
  ] },
  { id: 'business', label: 'Business', icon: 'building', tone: 'shared', children: [
    { label: 'My profile', href: `${M}/profile` },
    { label: 'Vendors', href: `${M}/vendors`, requirePerm: 'canManageVendors' },
  ] },
  { id: 'insights', label: 'Insights', icon: 'chart', tone: 'shared', children: [
    { label: 'Reports', href: `${M}/reports`, requirePerm: 'canViewReports' },
    { label: 'Analytics', href: `${M}/analytics`, requirePerm: 'canViewReports', hidden: true },
  ] },
  { id: 'settings', label: 'Settings', icon: 'settings', tone: 'shared', children: [
    // Delegated lists (maintenance coverage, restoration, AMC categories) — not for finance-only.
    { label: 'Settings', href: `${M}/settings`, financeHidden: true, match: [`${M}/maintenance-coverage`, `${M}/maintenance-list`, `${M}/restoration-list`, `${M}/amc/categories`] },
    { label: 'Templates', href: `${M}/templates`, requirePerm: 'canManageTemplates' },
  ] },
];

/**
 * Service provider (home services) — the Genspark Services pack mapped onto the real SP
 * pages. The active vertical is always Services. Demand and Operations are two views of the
 * one booking board (/operations): Requests + Quotes lanes are demand, Active + Closure the
 * work. `requirePerm: 'spSetupOpen'` = shown only while the account is not yet approved.
 */
const SERVICE_PROVIDER: OsGroup[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge', tone: 'shared', children: [
    { label: 'Overview', href: S },
  ] },
  { id: 'demand', label: 'Demand', icon: 'trending', tone: 'shared', children: [
    { label: 'Job requests', href: `${S}/operations?tab=requests` },
    { label: 'Quotes', href: `${S}/operations?tab=quotes` },
  ] },
  { id: 'operations', label: 'Operations', icon: 'calendar', tone: 'vertical', children: [
    // The booking board (Active + Closure lanes); /jobs redirects here, /jobs/[id] is a card.
    { label: 'Dispatch board', href: `${S}/operations`, match: [`${S}/jobs`] },
    // Jobs a landlord runs from their own page — no booking, so never on the board.
    { label: 'My jobs', href: `${S}/my-jobs` },
    { label: 'Schedule & shifts', href: `${S}/schedule` },
    { label: 'Live map', href: `${S}/live` },
  ] },
  { id: 'catalogue', label: 'Catalogue', icon: 'box', tone: 'vertical', children: [
    { label: 'Services & pricing', href: `${S}/services` },
    { label: 'Add service', href: `${S}/services/new` },
  ] },
  { id: 'finance', label: 'Finance', icon: 'wallet', tone: 'shared', children: [
    { label: 'Earnings & payouts', href: `${S}/earnings` },
  ] },
  { id: 'business', label: 'Business', icon: 'building', tone: 'shared', children: [
    { label: 'Business profile', href: `${S}/settings?tab=profile`, match: [`${S}/profile`] },
    { label: 'Documents & verification', href: `${S}/documents` },
    { label: 'Team & technicians', href: `${S}/settings?tab=team` },
    { label: 'Onboarding', href: `${S}/onboarding`, requirePerm: 'spSetupOpen' },
  ] },
  { id: 'insights', label: 'Insights', icon: 'chart', tone: 'shared', children: [
    { label: 'Reviews', href: `${S}/reviews` },
  ] },
  { id: 'settings', label: 'Settings', icon: 'settings', tone: 'shared', children: [
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

/** Services for a landlord: the service work on their own buildings (real maintenance,
 *  vendor and AMC pages) and a read-only view of the public service catalogue. */
function servicesGroups(): OsGroup[] {
  return RENTAL_PROVIDER.map((g) => {
    if (g.id === 'operations') return { ...g, badgeKey: undefined, children: [
      { label: 'Services overview', href: `${R}/v/services` },
      { label: 'Maintenance board', href: `${R}/operations?tab=maintenance` },
      { label: 'Maintenance requests', href: `${R}/maintenance`, match: [`${R}/maintenance/`] },
      { label: 'Vendors', href: `${R}/vendors`, match: [`${R}/vendors/`] },
      { label: 'AMC contracts', href: `${R}/amc`, match: [`${R}/amc/expenses`] },
      { label: 'Building inspections', href: `${R}/building-inspections`, match: [`${R}/building-inspections/`] },
    ] };
    if (g.id === 'catalogue') return { ...g, children: [
      { label: 'Service catalogue', href: `${R}/v/services/catalogue` },
    ] };
    // Vendors moved into Operations for this vertical — one home in the menu.
    if (g.id === 'business') return { ...g, children: g.children.filter((c) => c.href !== `${R}/vendors`) };
    return g;
  });
}

/** A non-Spaces vertical: Operations and Catalogue swap to that vertical (preview data). */
function verticalGroups(v: MsVerticalId): OsGroup[] {
  if (v === 'services') return servicesGroups();
  const label = verticalOf(v)?.label ?? v;
  return RENTAL_PROVIDER.map((g) => {
    if (g.id === 'operations') return { ...g, badgeKey: undefined, children: [
      { label: 'Calendar', href: `${R}/v/${v}/calendar`, preview: true },
      ...modelKids(v),
    ] };
    if (g.id === 'catalogue') return { ...g, children: [
      { label: `${label} offerings`, href: `${R}/v/${v}/catalogue`, preview: true },
      { label: 'Listings', href: `${R}/v/${v}/listings`, preview: true },
      { label: 'Create listing', href: `${R}/v/${v}/listings/new`, preview: true },
    ] };
    return g;
  });
}

/** Workspaces for a role, scoped to the active vertical (rental providers only). */
export function workspacesFor(role: UserRole, vertical: MsVerticalId = 'spaces'): OsGroup[] {
  if (role === 'rental_provider' && vertical !== 'spaces') return verticalGroups(vertical);
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
