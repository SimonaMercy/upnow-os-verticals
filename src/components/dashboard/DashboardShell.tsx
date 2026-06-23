'use client';

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Home, Search, Building2, FileText,
  CalendarCheck, Wrench, Users, Star, Wallet, BookOpen,
  Bell, Settings, LogOut, Menu, X, ChevronRight, ChevronLeft,
  ShieldCheck, ShieldAlert, BarChart2, AlertTriangle, Inbox, Briefcase, UserCircle,
  TrendingUp, UserCheck, DollarSign, MessageSquare, Receipt, BedDouble,
  Heart, HelpCircle, Archive, ClipboardList,
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { useAuth, dashboardPath, UserRole } from '@/contexts/AuthContext';
import { buildDisplayName } from '@/lib/utils';
import { cn } from '@/lib/utils';
import shell from './DashboardShell.module.css';
import { apiGet } from '@/lib/api';

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
type NavBadgeKey = 'leads' | 'properties' | 'units' | 'leases' | 'operations';
type NavCounts = Partial<Record<NavBadgeKey, number>>;

type NavItem =
  // `match` lists extra path prefixes that also activate the item — for sections
  // whose detail pages live under a different route than the nav href (e.g. the
  // Leases list is /orders but a lease opens at /contracts/:id/v2).
  | { label: string; href: string; icon: React.ElementType; soon?: boolean; requirePerm?: string; badgeKey?: NavBadgeKey; match?: string[] }
  | { divider: true }
  | { section: string };

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
    { label: 'Leases',           href: '/rental-provider/dashboard/orders',         icon: FileText, badgeKey: 'leases', match: ['/rental-provider/dashboard/contracts'] },
    { label: 'Ended Leases',     href: '/rental-provider/dashboard/ended-leases',   icon: Archive },
    { divider: true },
    { section: 'More' },
    { label: 'Templates',        href: '/rental-provider/dashboard/templates',      icon: BookOpen },
    { label: 'AMC & Vendors',    href: '/rental-provider/dashboard/amc',            icon: Wrench },
    { label: 'Communications',   href: '/rental-provider/dashboard/communications', icon: MessageSquare },
    { label: 'Reports',          href: '/rental-provider/dashboard/reports',        icon: BarChart2 },
    { divider: true },
    { label: 'Settings',         href: '/rental-provider/dashboard/settings',       icon: Settings },
  ],
  service_provider: [
    { label: 'Overview',         href: '/dashboard/service-provider',          icon: LayoutDashboard },
    { label: 'My Services',      href: '/dashboard/service-provider/services', icon: Briefcase },
    { label: 'Jobs',             href: '/dashboard/service-provider/jobs',     icon: CalendarCheck },
    { label: 'Team',             href: '/dashboard/service-provider/team',     icon: Users },
    { label: 'Reviews',          href: '/dashboard/service-provider/reviews',  icon: Star },
    { divider: true },
    { label: 'Earnings',         href: '/dashboard/service-provider/earnings', icon: Wallet, soon: true },
    { label: 'Settings',         href: '/dashboard/service-provider/settings', icon: Settings, soon: true },
  ],
  manager: [
    { label: 'Overview',         href: '/dashboard/manager',            icon: LayoutDashboard },
    { label: 'Leads',            href: '/dashboard/manager/viewings',   icon: TrendingUp, requirePerm: 'canManageViewings' },
    { label: 'Properties',       href: '/dashboard/manager/properties', icon: Building2, requirePerm: 'canListProperties' },
    { label: 'Units',            href: '/dashboard/manager/units',      icon: Home, requirePerm: 'canListProperties' },
    { label: 'Customers',        href: '/dashboard/manager/tenants',    icon: UserCheck, requirePerm: 'canManageAgreements' },
    { label: 'Payments',         href: '/dashboard/manager/payments',  icon: Wallet,  requirePerm: 'canManageDeposits', match: ['/dashboard/manager/deposits'] },
    { label: 'Operations',       href: '/dashboard/manager/operations', icon: ClipboardList, requirePerm: 'canManageAgreements' },
    { label: 'Leases',           href: '/dashboard/manager/contracts',  icon: FileText,  requirePerm: 'canManageAgreements' },
    { label: 'Ended Leases',     href: '/dashboard/manager/ended-leases', icon: Archive, requirePerm: 'canManageAgreements' },
    { divider: true },
    { section: 'More' },
    { label: 'Templates',        href: '/dashboard/manager/templates',  icon: BookOpen, requirePerm: 'canManageAgreements' },
    { label: 'Reports',          href: '/dashboard/manager/reports',    icon: BarChart2, requirePerm: 'canViewReports' },
    { label: 'AMC & Vendors',    href: '/dashboard/manager/amc',        icon: Wrench, requirePerm: 'canManageMaintenance' },
    { label: 'My Profile',       href: '/dashboard/manager/profile',    icon: UserCircle },
  ],
  technician: [
    { label: 'Overview',         href: '/dashboard/technician',                icon: LayoutDashboard },
    { label: 'My Jobs',          href: '/dashboard/technician/jobs',           icon: CalendarCheck },
    { label: 'Schedule',         href: '/dashboard/technician/schedule',       icon: CalendarCheck },
    { divider: true },
    { label: 'Settings',         href: '/dashboard/technician/settings',       icon: Settings, soon: true },
  ],
  admin: [
    { label: 'Overview',         href: '/dashboard/admin',                     icon: LayoutDashboard },
    { label: 'Users',            href: '/dashboard/admin/users',               icon: Users },
    { label: 'KYC Queue',        href: '/dashboard/admin/kyc',                 icon: ShieldCheck },
    { label: 'Listings',         href: '/dashboard/admin/listings',            icon: Building2 },
    { label: 'Risk',             href: '/dashboard/admin/risk',                icon: ShieldAlert },
    { label: 'Disputes',         href: '/dashboard/admin/disputes',            icon: AlertTriangle },
    { divider: true },
    { label: 'Analytics',        href: '/dashboard/admin/analytics',           icon: BarChart2 },
    { label: 'Inbox',            href: '/dashboard/admin/inbox',               icon: Inbox },
    { label: 'Settings',         href: '/dashboard/admin/settings',            icon: Settings, soon: true },
  ],
  super_admin: [
    { label: 'Overview',         href: '/dashboard/admin',                     icon: LayoutDashboard },
    { label: 'Users',            href: '/dashboard/admin/users',               icon: Users },
    { label: 'KYC Queue',        href: '/dashboard/admin/kyc',                 icon: ShieldCheck },
    { label: 'Listings',         href: '/dashboard/admin/listings',            icon: Building2 },
    { label: 'Risk',             href: '/dashboard/admin/risk',                icon: ShieldAlert },
    { label: 'Disputes',         href: '/dashboard/admin/disputes',            icon: AlertTriangle },
    { divider: true },
    { label: 'Analytics',        href: '/dashboard/admin/analytics',           icon: BarChart2 },
    { label: 'Inbox',            href: '/dashboard/admin/inbox',               icon: Inbox },
    { label: 'Settings',         href: '/dashboard/admin/settings',            icon: Settings, soon: true },
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
      ])
        .then(([p, c]: [NavCounts | null, { leases?: number; operations?: number } | null]) => {
          if (cancelled || (!p && !c)) return;
          setCounts({
            leads:      Number(p?.leads ?? 0),
            properties: Number(p?.properties ?? 0),
            units:      Number(p?.units ?? 0),
            leases:     Number(c?.leases ?? p?.leases ?? 0),
            operations: Number(c?.operations ?? 0),
          });
        })
        .catch(() => { /* keep last-known / empty */ });
    };
    load();
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 30_000) return;   // throttle re-fetch on focus churn
      load();
    };
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
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
  const rawNav = NAV[role] ?? [];
  // For managers: hide nav items whose requirePerm flag isn't granted, then drop
  // any section header left with no visible links under it (so a landlord that
  // withholds, say, all Finance permissions doesn't leave an empty "Finance").
  const navItems = role === 'manager'
    ? rawNav
        .filter(item => {
          if (!('requirePerm' in item)) return true;
          return managerPerms[(item as { requirePerm?: string }).requirePerm ?? ''] === true;
        })
        .filter((item, i, arr) => {
          if (!('section' in item)) return true;
          for (let j = i + 1; j < arr.length; j++) {
            if ('section' in arr[j]) return false;   // next section → this one is empty
            if ('label' in arr[j]) return true;      // a visible link → keep header
          }
          return false;                              // trailing empty section
        })
    : rawNav;
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
        href={dashboardPath(role)}
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
          const isActive = isOverview
            ? pathname === item.href
            : onPath(item.href) || (item.match?.some(onPath) ?? false);

          const badgeCount = item.badgeKey ? (counts[item.badgeKey] ?? 0) : 0;
          const hasBadge = badgeCount > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
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
  const { user, loading, isAuthenticated, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const checkedAuthRef = useRef(false);
  // Sidebar count badges — safe before auth resolves (hook no-ops for non-RP / undefined role).
  const navCounts = useNavBadgeCounts(user?.role as UserRole);

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
        if (!me) router.replace('/login');
      });
      return;
    }
    if (!isAuthenticated) {
      router.replace('/login');
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
  const hideSidebar = pathname?.endsWith('/rental-provider/dashboard/onboarding');

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-base-100)' }}>
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
          <button
            className="lg:hidden text-[var(--color-neutral-700)] hover:text-[var(--color-neutral-900)]"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
          </button>

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

          <div className="flex items-center gap-3">
            {/* KYC warning badge — only for roles that actually undergo KYC.
                Managers & technicians are invited sub-accounts and never do KYC. */}
            {['rental_provider', 'service_provider'].includes(role) && user.kycStatus && !['verified', 'approved'].includes(user.kycStatus) && (
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
