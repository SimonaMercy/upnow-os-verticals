'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu, X, LogOut, Building2, Calendar, MessageSquare,
  Settings, HelpCircle, Heart, Bell, UserCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth, dashboardPath } from '@/contexts/AuthContext';

const customerDropdownItems = [
  { label: 'Profile',          icon: UserCircle, href: '/dashboard/customer/profile' },
  { label: 'My Spaces',        icon: Building2,  href: '/dashboard/customer/spaces' },
  { label: 'My Services',      icon: Calendar,   href: '/dashboard/customer/services' },
  { label: 'Wishlist',         icon: Heart,      href: '/dashboard/customer/wishlist' },
  { label: 'Notifications',    icon: Bell,       href: '/dashboard/customer/notifications' },
  { label: 'Help Center',      icon: HelpCircle, href: '/dashboard/customer/help' },
] as const;

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

export function Navbar() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  useClickOutside(avatarRef, () => setAvatarOpen(false));

  const { isAuthenticated, user, signOut } = useAuth();
  const pathname = usePathname();

  const isServiceProviderContext = pathname?.startsWith('/providers/services') || pathname?.startsWith('/signup/service-provider');
  const isSpaceProviderContext = pathname?.startsWith('/providers/spaces') || pathname?.startsWith('/signup/space-provider');

  // T-107 — Auth routes (Sign Up always lands on the role-choice landing
  // section because the platform must NOT have a generic /register).
  const signUpPath = isServiceProviderContext
    ? '/register/service-provider'
    : isSpaceProviderContext
      ? '/register/rental-provider'
      : '/#signup';

  const signInPath = '/login';

  const handleSignOut = () => {
    signOut();
  };

  // role check for customer dashboard link
  const role = user?.role as string | undefined;
  const isCustomerRole = role === 'customer';

  const displayName = user?.name ?? [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const initials = displayName?.charAt(0)?.toUpperCase() ?? 'U';

  return (
    <>
      <nav
        className="sticky top-0 z-50 bg-white"
        style={{ boxShadow: 'var(--shadow-sm)', height: 64 }}
      >
        <div className="container h-full flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold" style={{ color: 'var(--primary)' }}>
            UpNow
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/services" className="font-[500] hover:text-primary transition-colors" style={{ color: 'var(--neutral-700)', fontSize: 16 }}>Services</Link>
            <Link href="/listings" className="font-[500] hover:text-primary transition-colors" style={{ color: 'var(--neutral-700)', fontSize: 16 }}>Spaces</Link>
            <Link href="/about"    className="font-[500] hover:text-primary transition-colors" style={{ color: 'var(--neutral-700)', fontSize: 16 }}>About Us</Link>
          </div>

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-3">
            {isAuthenticated ? (
              isCustomerRole ? (
              <div className="relative" ref={avatarRef}>
                <button
                  onClick={() => setAvatarOpen(!avatarOpen)}
                  className="flex items-center gap-2 border rounded-full py-1.5 px-1.5 hover:shadow-md transition-all cursor-pointer"
                  style={{ borderColor: 'var(--base-200)' }}
                >
                  <Menu size={16} style={{ color: 'var(--neutral-500)', marginLeft: 8 }} />
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'var(--primary)', color: 'white' }}
                  >
                    <span className="text-sm font-[700]">{initials}</span>
                  </div>
                </button>

                {avatarOpen && (
                  <div
                    className="absolute end-0 top-14 w-56 bg-white rounded-xl overflow-hidden z-50 py-2"
                    style={{ boxShadow: '0 8px 32px -4px rgba(0,0,0,0.16)' }}
                  >
                    {customerDropdownItems.map((item, i) => {
                      if ('divider' in item && item.divider) {
                        return <div key={i} className="border-t my-1" style={{ borderColor: 'var(--base-200)' }} />;
                      }
                      return (
                        <Link
                          key={i}
                          href={'href' in item ? item.href : '#'}
                          onClick={() => setAvatarOpen(false)}
                          className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-50 transition-colors"
                          style={{ color: 'var(--neutral-700)' }}
                        >
                          {'icon' in item && item.icon && <item.icon size={16} style={{ color: 'var(--neutral-400)' }} />}
                          {'label' in item && item.label}
                        </Link>
                      );
                    })}
                    <div className="border-t my-1" style={{ borderColor: 'var(--base-200)' }} />
                    <button
                      onClick={handleSignOut}
                      className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-50 transition-colors"
                      style={{ color: 'var(--neutral-700)' }}
                    >
                      <LogOut size={16} style={{ color: 'var(--neutral-400)' }} />
                      Log out
                    </button>
                  </div>
                )}
              </div>
              ) : (
                <>
                  <Link href={user?.role ? dashboardPath(user.role) : '/dashboard'}>
                    <Button variant="primary" size="sm">{displayName?.split(' ')[0] || 'Dashboard'}</Button>
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="flex items-center gap-1.5 text-sm font-[500] px-3 py-2 rounded-lg transition-colors"
                    style={{ color: 'var(--neutral-600)' }}
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </>
              )
            ) : (
              <>
                <Link href={signUpPath}><Button variant="primary" size="sm">Sign Up</Button></Link>
                <Link href={signInPath}><Button variant="secondary" size="sm">Sign In</Button></Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden"
            style={{ color: 'var(--neutral-700)' }}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={24} />
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawerOpen(false)} />
          <div
            className="absolute top-0 end-0 bottom-0 w-72 bg-white flex flex-col p-6"
            style={{ boxShadow: 'var(--shadow-lg)' }}
          >
            <button
              className="self-end mb-6"
              style={{ color: 'var(--neutral-700)' }}
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
            >
              <X size={24} />
            </button>

            <div className="flex flex-col gap-4">
              {([
                { href: '/', label: 'Home' },
                { href: '/services', label: 'Services' },
                { href: '/listings', label: 'Spaces' },
                { href: '/about', label: 'About' },
              ] as const).map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setDrawerOpen(false)}
                  className="font-[500] hover:text-primary transition-colors text-lg"
                  style={{ color: 'var(--neutral-700)' }}
                >
                  {label}
                </Link>
              ))}
            </div>

            <div className="border-t my-6" style={{ borderColor: 'var(--base-200)' }} />

            <div className="flex flex-col gap-3">
              {isAuthenticated ? (
                <>
                  <Link href={user?.role ? dashboardPath(user.role) : '/dashboard'} onClick={() => setDrawerOpen(false)}>
                    <Button variant="primary" size="md" className="w-full">Dashboard</Button>
                  </Link>
                  <Button variant="secondary" size="md" className="w-full" onClick={() => { setDrawerOpen(false); handleSignOut(); }}>
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <Link href={signUpPath} onClick={() => setDrawerOpen(false)}>
                    <Button variant="primary" size="md" className="w-full">Sign Up</Button>
                  </Link>
                  <Link href={signInPath} onClick={() => setDrawerOpen(false)}>
                    <Button variant="secondary" size="md" className="w-full">Sign In</Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
