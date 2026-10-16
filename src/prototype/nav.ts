/**
 * PROTOTYPE ONLY — target OS navigation model.
 *
 * Mirrors the production OS rail (`OS_GROUPS.rental_provider` in
 * src/components/dashboard/DashboardShell.tsx) and extends it per vertical:
 *
 *   1. Shared UpNow OS — exactly production's four groups: Demand, Calendar,
 *      Communications, Settings (Business/verification lives in Settings,
 *      per the owner's 4 Oct note "Business you can remove for now").
 *   2. One pack per authorised vertical. Spaces = production's ten pack groups
 *      with their real tabs (Live → the production page) plus one new
 *      "Bookings" group for the short-term models. The other six verticals use
 *      the pack menus defined in upnow-marketspace pages/provider-dashboard/pw/packs.js.
 *
 * Subcategories are never menu items; they are filters / asset and booking
 * types inside the pack.
 */
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, TrendingUp, CalendarCheck, Mail, Settings, Building2, UserCheck, FileText, CalendarRange,
  Wallet, ClipboardList, LineChart, Wrench, Scale, BarChart2, Package, Briefcase, Workflow, Compass, Ticket,
  CreditCard, BadgeCheck, GraduationCap, BookOpen, ShieldAlert, Stethoscope, HeartPulse, FileSearch, ScrollText,
} from 'lucide-react';
import type { RolePreset, VerticalId } from './types';

export type Perm = 'overview' | 'demand' | 'calendar' | 'customers' | 'finance' | 'reports' | 'listings' | 'business' | 'operate';

export const ROLE_PRESETS: Record<RolePreset, { label: string; description: string; perms: Perm[] }> = {
  owner: {
    label: 'Owner',
    description: 'Full access to every module and every authorised vertical.',
    perms: ['overview', 'demand', 'calendar', 'customers', 'finance', 'reports', 'listings', 'business', 'operate'],
  },
  leasing_agent: {
    label: 'Sales / leasing agent',
    description: 'Works enquiries, listings and day-to-day operations. No finance or business settings.',
    perms: ['overview', 'demand', 'calendar', 'customers', 'listings', 'operate'],
  },
  accountant: {
    label: 'Accountant',
    description: 'Finance and reports only — each pack shows just its Overview, Transactions / Performance & Economics and Reports.',
    perms: ['overview', 'customers', 'finance', 'reports'],
  },
  front_desk: {
    label: 'Front desk',
    description: 'Runs the calendar and bookings. No listings, finance or settings.',
    perms: ['overview', 'calendar', 'demand', 'operate'],
  },
};

export const BASE = '/prototype/os';
export const href = (slug: string) => (slug ? `${BASE}/${slug}` : BASE);

// ── Live production screens, hosted inside the new shell ───────────────────
/** Production rental-provider base and its mirror inside the prototype (src/app/prototype/os/rp/**). */
export const RP_PREFIX = '/rental-provider/dashboard';
export const BRIDGE = `${BASE}/rp`;
/** Production RP path → the same screen inside the new OS (other paths are returned unchanged). */
export function toBridge(path: string): string {
  if (path === RP_PREFIX || path.startsWith(`${RP_PREFIX}/`) || path.startsWith(`${RP_PREFIX}?`) || path.startsWith(`${RP_PREFIX}#`)) {
    return BRIDGE + path.slice(RP_PREFIX.length);
  }
  return path;
}
/** True when a live tab can be hosted inside the shell (Spaces / rental provider). */
export const isBridged = (live?: string) => !!live && toBridge(live) !== live;

// ── Shared UpNow OS (production's four groups) ─────────────────────────────
export interface SharedTab { label: string; href: string; live?: boolean }
export interface SharedModule { slug: string; label: string; icon: LucideIcon; perm: Perm; hint: string; production?: string; tabs: SharedTab[] }

export const SHARED_MODULES: SharedModule[] = [
  { slug: 'demand', label: 'Demand', icon: TrendingUp, perm: 'demand', hint: 'One enquiry inbox for every vertical', production: '/rental-provider/dashboard/leads',
    tabs: [{ label: 'All verticals', href: `${BASE}/demand` }, { label: 'Spaces lease pipeline', href: '/rental-provider/dashboard/leads', live: true }] },
  { slug: 'calendar', label: 'Calendar', icon: CalendarCheck, perm: 'calendar', hint: 'Viewings, bookings, sessions and appointments', production: '/rental-provider/dashboard/leads?view=calendar',
    tabs: [{ label: 'All verticals', href: `${BASE}/calendar` }, { label: 'Spaces viewings', href: '/rental-provider/dashboard/leads?view=calendar', live: true }] },
  { slug: 'communications', label: 'Communications', icon: Mail, perm: 'demand', hint: 'Email and WhatsApp across verticals', production: '/rental-provider/dashboard/communications',
    tabs: [{ label: 'All verticals', href: `${BASE}/communications` }, { label: 'Emails', href: '/rental-provider/dashboard/communications', live: true }, { label: 'WhatsApp', href: '/rental-provider/dashboard/whatsapp', live: true }] },
  { slug: 'settings', label: 'Settings', icon: Settings, perm: 'business', hint: 'Business, verification, verticals, team, audit', production: '/rental-provider/dashboard/settings',
    tabs: [{ label: 'Business', href: `${BASE}/settings` }, { label: 'Spaces settings', href: '/rental-provider/dashboard/settings', live: true }, { label: 'Templates', href: '/rental-provider/dashboard/templates', live: true }, { label: 'My profile', href: '/rental-provider/dashboard/profile', live: true }] },
];

/** Business-wide roll-ups (reached from the business Overview, not the rail). */
export const BUSINESS_VIEWS: { slug: string; label: string; perm: Perm; hint: string }[] = [
  { slug: 'customers', label: 'Customers across verticals', perm: 'customers', hint: 'One record per customer, whatever they lease, book or join' },
  { slug: 'listings', label: 'Listings across verticals', perm: 'listings', hint: 'Every listing and its review status' },
  { slug: 'finance', label: 'Money across verticals', perm: 'finance', hint: 'Invoices, payments, deposits, refunds and payouts' },
  { slug: 'reports', label: 'Reports across verticals', perm: 'reports', hint: 'Cross-vertical reports plus each pack’s catalogue' },
];

// ── Vertical packs ─────────────────────────────────────────────────────────
/** A tab inside a pack group: either a prototype screen or a live production page. */
export interface PackTab { slug: string; label: string; live?: string; perm?: Perm }
export interface PackItem {
  slug: string;
  label: string;
  icon: LucideIcon;
  perm: Perm;
  hint: string;
  tabs: PackTab[];
  /** Planned group: shown dimmed with an "In development" page (production's `soon`). */
  soon?: boolean;
  /** Group added by the multi-vertical work (not in production today). */
  isNew?: boolean;
}

const RP = '/rental-provider/dashboard';
const SP = '/dashboard/service-provider';

const overview = (hint: string): PackItem => ({ slug: 'overview', label: 'Overview', icon: LayoutDashboard, perm: 'overview', hint, tabs: [{ slug: 'overview', label: 'Overview' }] });
const perf = (extra: PackTab[] = []): PackItem => ({
  slug: 'performance', label: 'Performance & Economics', icon: LineChart, perm: 'finance', hint: 'Revenue, payments, refunds and payouts for this vertical',
  tabs: [{ slug: 'money', label: 'Money' }, ...extra],
});
const reports = (extra: PackTab[] = []): PackItem => ({
  slug: 'reports', label: 'Reports', icon: BarChart2, perm: 'reports', hint: 'This pack’s report catalogue', tabs: [...extra, { slug: 'pack-reports', label: 'Reports' }],
});
const soon = (slug: string, label: string, icon: LucideIcon, hint: string): PackItem => ({ slug, label, icon, perm: 'operate', hint, tabs: [], soon: true });
const listingsTab: PackTab = { slug: 'listings', label: 'Listings', perm: 'listings' };

export const PACKS: Record<VerticalId, PackItem[]> = {
  // Production OS_GROUPS.rental_provider, same names, order and tabs — plus "Bookings".
  spaces: [
    { slug: 'overview', label: 'Overview', icon: LayoutDashboard, perm: 'overview', hint: 'Pack overview and the production Spaces dashboard',
      tabs: [{ slug: 'overview', label: 'Pack overview' }, { slug: 'dashboard', label: 'Spaces dashboard', live: RP }] },
    { slug: 'portfolio', label: 'Portfolio', icon: Building2, perm: 'operate', hint: 'Properties, units and short-term assets',
      tabs: [{ slug: 'properties', label: 'Properties', live: `${RP}/portfolio` }, { slug: 'units', label: 'Units', live: `${RP}/units` }, { slug: 'assets', label: 'Short-term assets' }, listingsTab] },
    { slug: 'customers', label: 'Customers', icon: UserCheck, perm: 'customers', hint: 'Lease customers',
      tabs: [{ slug: 'customers', label: 'Customers', live: `${RP}/tenants` }] },
    { slug: 'leases', label: 'Leases', icon: FileText, perm: 'operate', hint: 'Long-term leases — production lease engine, unchanged',
      tabs: [{ slug: 'leases', label: 'Leases', live: `${RP}/orders` }, { slug: 'ended-leases', label: 'Ended Leases', live: `${RP}/ended-leases` }, { slug: 'leasing', label: 'About the lease engine' }] },
    { slug: 'bookings', label: 'Bookings', icon: CalendarRange, perm: 'operate', isNew: true, hint: 'Holiday stays, venues, courts and yacht charters',
      tabs: [{ slug: 'stays', label: 'Holiday stays' }, { slug: 'venues', label: 'Venues & events' }, { slug: 'courts', label: 'Courts' }, { slug: 'charters', label: 'Yacht charters' }] },
    { slug: 'transactions', label: 'Transactions', icon: Wallet, perm: 'finance', hint: 'Lease payments, cheques and deposits; booking payments',
      tabs: [{ slug: 'payments', label: 'Payments', live: `${RP}/payments` }, { slug: 'booking-payments', label: 'Booking payments' }] },
    { slug: 'operations', label: 'Operations', icon: ClipboardList, perm: 'operate', hint: 'Ops board',
      tabs: [{ slug: 'ops-board', label: 'Ops Board', live: `${RP}/operations` }] },
    { slug: 'performance', label: 'Performance & Economics', icon: LineChart, perm: 'finance', hint: 'Team activity and economics',
      tabs: [{ slug: 'team', label: 'Team', live: `${RP}/team` }] },
    { slug: 'maintenance', label: 'Maintenance', icon: Wrench, perm: 'operate', hint: 'Requests, vendors, AMC, building inspections',
      tabs: [{ slug: 'requests', label: 'Requests', live: `${RP}/maintenance` }, { slug: 'vendors', label: 'Vendors', live: `${RP}/vendors` }, { slug: 'amc', label: 'AMC', live: `${RP}/amc` }, { slug: 'building-inspections', label: 'Building inspections', live: `${RP}/building-inspections` }] },
    { slug: 'cases', label: 'Cases', icon: Scale, perm: 'operate', hint: 'Breaches and legal',
      tabs: [{ slug: 'breaches', label: 'Breaches', live: `${RP}/breaches` }, { slug: 'legal', label: 'Legal', live: `${RP}/legal` }] },
    reports([{ slug: 'production-reports', label: 'Lease reports', live: `${RP}/reports` }]),
  ],
  // MarketSpace packs.js: Overview | Services & Pricing | Jobs & Contracts | Operations | Performance & Economics | Cases | Reports
  services: [
    overview('Services pack overview'),
    { slug: 'pricing', label: 'Services & Pricing', icon: Package, perm: 'operate', hint: 'Offerings and listings',
      tabs: [{ slug: 'offerings', label: 'Offerings' }, listingsTab, { slug: 'sp-services', label: 'My Services', live: `${SP}/services` }] },
    { slug: 'jobs', label: 'Jobs & Contracts', icon: Briefcase, perm: 'operate', hint: 'Field jobs and quoted projects',
      tabs: [{ slug: 'jobs-board', label: 'Jobs board' }, { slug: 'quotes', label: 'Quoted projects' }, { slug: 'sp-operations', label: 'Operations board', live: `${SP}/operations` }] },
    { slug: 'operations', label: 'Operations', icon: Workflow, perm: 'operate', hint: 'Appointments, roster and live map',
      tabs: [{ slug: 'appointments', label: 'Appointments' }, { slug: 'roster', label: 'Roster', live: `${SP}/schedule` }, { slug: 'live-map', label: 'Live map', live: `${SP}/live` }] },
    perf([{ slug: 'earnings', label: 'Earnings', live: `${SP}/earnings` }]),
    soon('cases', 'Cases', Scale, 'Disputes and complaints'),
    reports(),
  ],
  // Overview | Experiences & Sessions | Reservations & Guests | Operations | Performance & Economics | Safety & Cases | Reports
  experiences: [
    overview('Experiences pack overview'),
    { slug: 'sessions', label: 'Experiences & Sessions', icon: Compass, perm: 'operate', hint: 'Products, sessions and capacity',
      tabs: [{ slug: 'sessions', label: 'Sessions & capacity' }, listingsTab] },
    { slug: 'reservations', label: 'Reservations & Guests', icon: Ticket, perm: 'operate', hint: 'Seat reservations and guests',
      tabs: [{ slug: 'reservations', label: 'Reservations' }] },
    soon('operations', 'Operations', Workflow, 'Guides, vehicles and pickups'),
    perf(),
    soon('cases', 'Safety & Cases', ShieldAlert, 'Waivers, incidents and complaints'),
    reports(),
  ],
  // Overview | Plans & Access | Memberships | Operations | Performance & Economics | Cases | Reports
  memberships: [
    overview('Memberships pack overview'),
    { slug: 'plans', label: 'Plans & Access', icon: CreditCard, perm: 'operate', hint: 'Plans, benefits and access',
      tabs: [{ slug: 'plans', label: 'Plans' }, listingsTab] },
    { slug: 'memberships', label: 'Memberships', icon: BadgeCheck, perm: 'operate', hint: 'Members and credits',
      tabs: [{ slug: 'members', label: 'Members' }, { slug: 'credits', label: 'Credits ledger' }] },
    soon('operations', 'Operations', Workflow, 'Check-ins, classes and trainers'),
    perf(),
    soon('cases', 'Cases', Scale, 'Complaints and cancellations'),
    reports(),
  ],
  // Overview | Programs & Admissions | Learning Operations | Performance & Economics | Safeguarding & Cases | Reports
  programs: [
    overview('Programs pack overview'),
    { slug: 'admissions', label: 'Programs & Admissions', icon: GraduationCap, perm: 'operate', hint: 'Applications, enrolments and listings',
      tabs: [{ slug: 'applications', label: 'Applications' }, { slug: 'enrolments', label: 'Enrolments' }, listingsTab] },
    { slug: 'learning', label: 'Learning Operations', icon: BookOpen, perm: 'operate', hint: 'Attendance and timetables',
      tabs: [{ slug: 'attendance', label: 'Attendance' }] },
    perf(),
    soon('cases', 'Safeguarding & Cases', ShieldAlert, 'Safeguarding records and incidents'),
    reports(),
  ],
  // Overview | Care Catalogue | Appointments & Patients | Clinical Operations | Performance & Economics | Compliance & Incidents | Reports
  health: [
    overview('Health pack overview'),
    { slug: 'catalogue', label: 'Care Catalogue', icon: HeartPulse, perm: 'operate', hint: 'Practitioners, services and listings',
      tabs: [{ slug: 'practitioners', label: 'Practitioners' }, listingsTab] },
    { slug: 'patients', label: 'Appointments & Patients', icon: Stethoscope, perm: 'operate', hint: 'Appointments with restricted patient data',
      tabs: [{ slug: 'appointments', label: 'Appointments' }] },
    soon('clinical', 'Clinical Operations', Workflow, 'Rooms, equipment and care plans'),
    perf(),
    soon('compliance', 'Compliance & Incidents', ShieldAlert, 'DHA compliance and incident reports'),
    reports(),
  ],
  // Overview | Products & Quotes | Policies & Claims | Operations | Performance & Economics | Cases | Reports
  insurance: [
    overview('Protection pack overview'),
    { slug: 'products', label: 'Products & Quotes', icon: FileSearch, perm: 'operate', hint: 'Quote requests and products',
      tabs: [{ slug: 'quotes', label: 'Quote requests' }, listingsTab] },
    { slug: 'policies', label: 'Policies & Claims', icon: ScrollText, perm: 'operate', hint: 'Policies and renewals',
      tabs: [{ slug: 'policies', label: 'Policies' }] },
    soon('operations', 'Operations', Workflow, 'Insurer panel and documents'),
    perf(),
    soon('cases', 'Cases', Scale, 'Claims support and complaints'),
    reports(),
  ],
};

/** The group that owns a tab slug (or the group itself). */
export function findPackItem(v: VerticalId, slug?: string): { item: PackItem; tab?: PackTab } | null {
  if (!slug) return null;
  const item = PACKS[v].find((i) => i.slug === slug);
  if (item) return { item };
  for (const i of PACKS[v]) {
    const tab = i.tabs.find((t) => t.slug === slug);
    if (tab) return { item: i, tab };
  }
  return null;
}

/** Link to a pack, a group, or a tab (tab slugs resolve to their group). Live Spaces tabs resolve to their bridged screen. */
export function packHref(v: VerticalId, slug?: string) {
  const root = `${BASE}/v/${v}`;
  if (!slug) return root;
  const hit = findPackItem(v, slug);
  if (!hit) return `${root}/${slug}`;
  if (hit.tab) return isBridged(hit.tab.live) ? toBridge(hit.tab.live!) : `${root}/${hit.item.slug}/${hit.tab.slug}`;
  const first = hit.item.tabs[0];
  if (first && isBridged(first.live)) return toBridge(first.live!);
  return `${root}/${hit.item.slug}`;
}

/** Production detail routes that belong to a Spaces group but are not tabs themselves. */
const EXTRA_PACK_PREFIXES: Record<string, string> = {
  contracts: 'leases', deposits: 'transactions', receivables: 'transactions', analytics: 'performance', units: 'portfolio',
};
const EXTRA_SHARED_PREFIXES: Record<string, string> = {
  leads: 'demand', communications: 'communications', whatsapp: 'communications', settings: 'settings', templates: 'settings',
  profile: 'settings', onboarding: 'settings', documents: 'settings', 'maintenance-list': 'settings', 'restoration-list': 'settings',
};

/** Which group a bridged production screen belongs to (drives sidebar highlight and the tab strip). */
export function matchBridge(pathname: string, search = ''): { pack?: { item: PackItem; tab?: PackTab }; shared?: SharedModule } | null {
  if (!pathname.startsWith(BRIDGE)) return null;
  const rest = pathname.slice(BRIDGE.length).split('/').filter(Boolean);
  const prod = RP_PREFIX + (rest.length ? `/${rest.join('/')}` : '');
  const full = prod + search;
  // Shared groups first (exact live tab, e.g. leads?view=calendar), then by first path segment.
  const sharedTab = SHARED_MODULES.find((m) => m.tabs.some((t) => t.live && t.href === full)) ?? SHARED_MODULES.find((m) => m.tabs.some((t) => t.live && t.href === prod && !t.href.includes('?')));
  if (sharedTab && !(sharedTab.slug === 'demand' && search.includes('view=calendar'))) return { shared: sharedTab };
  if (rest[0] === 'leads' && search.includes('view=calendar')) return { shared: SHARED_MODULES.find((m) => m.slug === 'calendar') };
  if (rest[0] && EXTRA_SHARED_PREFIXES[rest[0]]) return { shared: SHARED_MODULES.find((m) => m.slug === EXTRA_SHARED_PREFIXES[rest[0]]) };
  let best: { item: PackItem; tab?: PackTab; len: number } | null = null;
  for (const item of PACKS.spaces) {
    for (const tab of item.tabs) {
      if (!tab.live || !isBridged(tab.live)) continue;
      const lp = tab.live.split('?')[0];
      const hit = lp === RP_PREFIX ? prod === RP_PREFIX : prod === lp || prod.startsWith(`${lp}/`);
      if (hit && (!best || lp.length > best.len)) best = { item, tab, len: lp.length };
    }
  }
  if (best) return { pack: { item: best.item, tab: best.tab } };
  if (rest[0] && EXTRA_PACK_PREFIXES[rest[0]]) {
    const item = PACKS.spaces.find((i) => i.slug === EXTRA_PACK_PREFIXES[rest[0]]);
    if (item) return { pack: { item, tab: item.tabs.find((t) => t.live) } };
  }
  return null;
}

/** Permission a pack tab needs (tab override, else its group's). */
export const tabPerm = (item: PackItem, tab?: PackTab): Perm => tab?.perm ?? item.perm;

/** Items a role can see in a pack (soon groups follow the group perm). */
export function visibleItems(v: VerticalId, perms: Perm[]) {
  return PACKS[v].filter((i) => perms.includes(i.perm));
}
