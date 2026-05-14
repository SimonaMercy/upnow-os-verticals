'use client';

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Home, Search, Building2, Layers, FileText,
  CalendarCheck, Wrench, Users, Star, Wallet, BookOpen,
  Bell, Settings, LogOut, Menu, X, ChevronRight,
  ShieldCheck, BarChart2, AlertTriangle, Inbox, Briefcase, UserCircle,
  TrendingUp, UserCheck, DollarSign, MessageSquare, Receipt, BedDouble,
} from 'lucide-react';
import { useAuth, dashboardPath, UserRole } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

/* ─────────────────────────────────────────────
   Nav definitions per role
───────────────────────────────────────────── */
type NavItem =
  | { label: string; href: string; icon: React.ElementType }
  | { divider: true }
  | { section: string };

const NAV: Record<UserRole, NavItem[]> = {
  customer: [
    { label: 'Overview',     href: '/dashboard/customer',            icon: LayoutDashboard },
    { label: 'My Spaces',    href: '/dashboard/customer/spaces',     icon: BedDouble },
    { label: 'My Services',  href: '/dashboard/customer/bookings',   icon: CalendarCheck },
    { divider: true },
    { label: 'Documents',    href: '/dashboard/customer/documents',  icon: Layers },
    { label: 'Settings',     href: '/dashboard/customer/settings',   icon: Settings },
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
}: {
  role: UserRole;
  pathname: string;
  onClose?: () => void;
}) {
  const navItems = NAV[role] ?? [];
  const { user, signOut } = useAuth();
  const router = useRouter();

  const displayName =
    user?.name ??
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ??
    'User';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <aside
      className="flex flex-col h-full"
      style={{
        width: 240,
        backgroundColor: 'var(--color-neutral-900)',
        color: '#fff',
      }}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-6 py-5">
        <Link href="/dashboard" className="font-bold text-xl" style={{ color: 'var(--color-primary)' }}>
          UpNow
        </Link>
        {onClose && (
          <button onClick={onClose} className="text-white/60 hover:text-white lg:hidden">
            <X size={20} />
          </button>
        )}
      </div>

      {/* Role badge */}
      <div className="px-6 pb-4">
        <span
          className="text-xs font-semibold px-2 py-1 rounded-full"
          style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
        >
          {ROLE_LABEL[role]}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {navItems.map((item, i) => {
          if ('divider' in item) {
            return <hr key={i} className="my-3 border-white/10" />;
          }
          if ('section' in item) {
            return (
              <p
                key={i}
                className="mt-5 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.35)' }}
              >
                {item.section}
              </p>
            );
          }
          const Icon = item.icon;
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
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              )}
            >
              <Icon size={18} />
              {item.label}
              {isActive && <ChevronRight size={14} className="ml-auto opacity-50" />}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <p className="text-xs text-white/50 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={() => { signOut(); router.push('/'); }}
          className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors w-full"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </aside>
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
  const checkedAuthRef = useRef(false);

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

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-base-100)' }}>
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0 h-full" style={{ width: 240 }}>
        <Sidebar role={role} pathname={pathname} />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
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
        {/* Topbar */}
        <header
          className="flex-shrink-0 flex items-center justify-between px-5 h-14 border-b"
          style={{
            backgroundColor: '#fff',
            borderColor: 'var(--color-base-200)',
          }}
        >
          <button
            className="lg:hidden text-[var(--color-neutral-700)] hover:text-[var(--color-neutral-900)]"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
          </button>

          <div className="hidden lg:block" />

          <div className="flex items-center gap-3">
            {/* KYC warning badge */}
            {user.kycStatus && user.kycStatus !== 'verified' && (
              <Link
                href={`${dashboardPath(role)}/documents`}
                className="hidden sm:flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
                style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
              >
                <AlertTriangle size={12} />
                KYC {user.kycStatus === 'pending' ? 'pending' : 'required'}
              </Link>
            )}
            <button className="relative text-[var(--color-neutral-500)] hover:text-[var(--color-neutral-900)]">
              <Bell size={20} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
