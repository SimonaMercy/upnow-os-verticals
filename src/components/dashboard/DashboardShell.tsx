'use client';

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Home, Search, Building2, Layers, FileText,
  CalendarCheck, Wrench, Users, Star, Wallet, BookOpen,
  Bell, Settings, LogOut, Menu, X, ChevronRight, ChevronLeft,
  ShieldCheck, BarChart2, AlertTriangle, Inbox, Briefcase, UserCircle,
  TrendingUp, UserCheck, DollarSign, MessageSquare, Receipt, BedDouble,
  Heart, HelpCircle,
} from 'lucide-react';
import { useAuth, dashboardPath, UserRole } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import shell from './DashboardShell.module.css';

/* ─────────────────────────────────────────────
   Nav definitions per role
───────────────────────────────────────────── */
type NavItem =
  | { label: string; href: string; icon: React.ElementType; soon?: boolean }
  | { divider: true }
  | { section: string };

const NAV: Record<UserRole, NavItem[]> = {
  customer: [
    { label: 'My Spaces',   href: '/dashboard/customer/spaces',   icon: BedDouble },
    { label: 'My Services', href: '/dashboard/customer/services', icon: Wrench },
    { label: 'My Profile',  href: '/dashboard/customer/profile',  icon: UserCircle },
  ],
  rental_provider: [
    { label: 'Dashboard',       href: '/rental-provider/dashboard',                icon: LayoutDashboard },
    { label: 'My Properties',  href: '/rental-provider/dashboard/portfolio',       icon: Building2 },
    { section: 'Leasing' },
    { label: 'Leads',          href: '/rental-provider/dashboard/leads',           icon: TrendingUp },
    { label: 'Contracts',      href: '/rental-provider/dashboard/orders',          icon: FileText },
    { section: 'Finance' },
    { label: 'Receivables',    href: '/rental-provider/dashboard/receivables',     icon: Receipt },
    { label: 'Deposits',       href: '/rental-provider/dashboard/deposits',        icon: Wallet },
    { section: 'Operations' },
    { label: 'AMC & Vendors',  href: '/rental-provider/dashboard/amc',             icon: Wrench },
    { divider: true },
    { label: 'Communications', href: '/rental-provider/dashboard/communications',  icon: MessageSquare },
    { label: 'Reports',        href: '/rental-provider/dashboard/reports',         icon: BarChart2 },
    { label: 'Team',           href: '/rental-provider/dashboard/team',            icon: Users },
    { label: 'Tenants',        href: '/rental-provider/dashboard/tenants',         icon: UserCheck },
    { divider: true },
    { label: 'Settings',       href: '/rental-provider/dashboard/settings',        icon: Settings },
  ],
  service_provider: [
    { label: 'Overview',         href: '/dashboard/service-provider',          icon: LayoutDashboard },
    { label: 'My Services',      href: '/dashboard/service-provider/services', icon: Briefcase },
    { label: 'Jobs',             href: '/dashboard/service-provider/jobs',     icon: CalendarCheck },
    { label: 'Team',             href: '/dashboard/service-provider/team',     icon: Users },
    { label: 'Reviews',          href: '/dashboard/service-provider/reviews',  icon: Star },
    { divider: true },
    { label: 'Earnings',         href: '/dashboard/service-provider/earnings', icon: Wallet },
    { label: 'Settings',         href: '/dashboard/service-provider/settings', icon: Settings },
  ],
  manager: [
    { label: 'Overview',         href: '/dashboard/manager',                   icon: LayoutDashboard },
    { label: 'Properties',       href: '/dashboard/manager/properties',        icon: Building2 },
    { label: 'Contracts',        href: '/dashboard/manager/contracts',         icon: FileText },
    { label: 'Maintenance',      href: '/dashboard/manager/maintenance',       icon: Wrench },
    { divider: true },
    { label: 'Settings',         href: '/dashboard/manager/settings',          icon: Settings },
  ],
  technician: [
    { label: 'Overview',         href: '/dashboard/technician',                icon: LayoutDashboard },
    { label: 'My Jobs',          href: '/dashboard/technician/jobs',           icon: CalendarCheck },
    { label: 'Schedule',         href: '/dashboard/technician/schedule',       icon: CalendarCheck },
    { divider: true },
    { label: 'Settings',         href: '/dashboard/technician/settings',       icon: Settings },
  ],
  admin: [
    { label: 'Overview',         href: '/dashboard/admin',                     icon: LayoutDashboard },
    { label: 'Users',            href: '/dashboard/admin/users',               icon: Users },
    { label: 'KYC Queue',        href: '/dashboard/admin/kyc',                 icon: ShieldCheck },
    { label: 'Listings',         href: '/dashboard/admin/listings',            icon: Building2 },
    { label: 'Disputes',         href: '/dashboard/admin/disputes',            icon: AlertTriangle },
    { divider: true },
    { label: 'Analytics',        href: '/dashboard/admin/analytics',           icon: BarChart2 },
    { label: 'Inbox',            href: '/dashboard/admin/inbox',               icon: Inbox },
    { label: 'Settings',         href: '/dashboard/admin/settings',            icon: Settings },
  ],
  super_admin: [
    { label: 'Overview',         href: '/dashboard/admin',                     icon: LayoutDashboard },
    { label: 'Users',            href: '/dashboard/admin/users',               icon: Users },
    { label: 'KYC Queue',        href: '/dashboard/admin/kyc',                 icon: ShieldCheck },
    { label: 'Listings',         href: '/dashboard/admin/listings',            icon: Building2 },
    { label: 'Disputes',         href: '/dashboard/admin/disputes',            icon: AlertTriangle },
    { divider: true },
    { label: 'Analytics',        href: '/dashboard/admin/analytics',           icon: BarChart2 },
    { label: 'Inbox',            href: '/dashboard/admin/inbox',               icon: Inbox },
    { label: 'Settings',         href: '/dashboard/admin/settings',            icon: Settings },
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
   Sidebar
───────────────────────────────────────────── */
function Sidebar({
  role,
  pathname,
  onClose,
  collapsed = false,
}: {
  role: UserRole;
  pathname: string;
  onClose?: () => void;
  collapsed?: boolean;
}) {
  const navItems = NAV[role] ?? [];
  const { user, signOut } = useAuth();

  const displayName =
    user?.name ??
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ??
    'User';
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
          const isActive = isOverview
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + '/');

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(shell.item, isActive && shell.active)}
              style={collapsed ? { justifyContent: 'center', padding: '8px', gap: 0 } : undefined}
              title={collapsed ? item.label : undefined}
            >
              <span className={shell.glyph}><Icon size={16} /></span>
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && isActive && <ChevronRight size={14} className={shell.activeChevron} />}
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

  const displayName =
    user?.name ?? [user?.firstName, user?.lastName].filter(Boolean).join(' ') ?? 'You';
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
          <Sidebar role={role} pathname={pathname} collapsed={sidebarCollapsed} />
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
            <Sidebar role={role} pathname={pathname} onClose={() => setSidebarOpen(false)} />
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
            {/* KYC warning badge — only for non-customer roles */}
            {role !== 'customer' && user.kycStatus && !['verified', 'approved'].includes(user.kycStatus) && (
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
            <button className="relative text-[var(--color-neutral-500)] hover:text-[var(--color-neutral-900)]">
              <Bell size={20} />
            </button>

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
