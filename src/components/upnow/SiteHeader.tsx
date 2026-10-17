'use client';

/**
 * SiteHeader — the single public header shared across the landing, services and
 * listings pages. Brand + Sign in / Sign up popups (AuthModal) for guests, an
 * avatar menu for customers, a dashboard shortcut for other roles, and a mobile
 * drawer. Replaces the old per-page headers (LandingNav / Navbar / inline).
 */

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Menu, X, LogOut, Building2, UserCircle, Bell, Calendar, HelpCircle,
} from 'lucide-react';
import { useAuth, dashboardPath } from '@/contexts/AuthContext';
import { CustomerRenewalBanner } from '@/components/upnow/CustomerRenewalBanner';
import { AuthModal, type AuthModalMode } from '@/components/upnow/AuthModal';
import { PublicPageTracker } from '@/components/upnow/PublicPageTracker';

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

const customerDropdownItems = [
  { label: 'Profile', icon: UserCircle, href: '/dashboard/customer/profile' },
  { label: 'My Spaces', icon: Building2, href: '/dashboard/customer/spaces' },
  { label: 'My Services', icon: Calendar, href: '/dashboard/customer/services' },
  { label: 'Notifications', icon: Bell, href: '/dashboard/customer/notifications' },
  { label: 'Help Center', icon: HelpCircle, href: '/dashboard/customer/help' },
] as const;

export function SiteHeader() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthModalMode | null>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  useClickOutside(avatarRef, () => setAvatarOpen(false));

  const { isAuthenticated, user, signOut, loading } = useAuth();
  const displayName = user?.name ?? [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const initials = displayName?.charAt(0)?.toUpperCase() ?? 'U';
  const isCustomerRole = user?.role === 'customer';

  // /login and /register redirect here with ?auth=signin|signup (there are no
  // separate auth pages). Open the matching popup, then strip the param so a
  // refresh or back-nav doesn't reopen it.
  useEffect(() => {
    if (loading || isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const a = params.get('auth');
    if (a === 'signin' || a === 'signup') {
      setAuthMode(a);
      params.delete('auth');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, [loading, isAuthenticated]);

  return (
    <>
      <PublicPageTracker />
      <header className="l-nav">
        <div className="l-nav-inner">
          {/* Brand */}
          <Link href="/" className="l-brand">
            <span className="l-brand-mark">U</span>
            UpNow
          </Link>

          {/* Right: auth */}
          <div className="l-nav-actions hidden md:flex">
            {isAuthenticated ? (
              isCustomerRole ? (
                <div className="relative" ref={avatarRef}>
                  <button
                    onClick={() => setAvatarOpen(!avatarOpen)}
                    className="flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 hover:shadow-md transition-all cursor-pointer"
                    style={{ border: '1px solid #e4e9e5', background: 'white' }}
                  >
                    <Menu size={16} style={{ color: '#5f6b63' }} />
                    <div
                      style={{
                        width: 32, height: 32, borderRadius: '50%',
                        backgroundColor: '#047246', color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                      }}
                    >
                      {initials}
                    </div>
                  </button>
                  {avatarOpen && (
                    <div
                      style={{
                        position: 'absolute', right: 0, top: 52, width: 224,
                        backgroundColor: 'white', borderRadius: 12,
                        boxShadow: '0 8px 32px -4px rgba(0,0,0,0.16)',
                        overflow: 'hidden', zIndex: 60, padding: '6px 0',
                      }}
                    >
                      {customerDropdownItems.map((item) => (
                        <Link
                          key={item.label}
                          href={item.href}
                          onClick={() => setAvatarOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-sm"
                          style={{ color: '#46534c' }}
                        >
                          <item.icon size={16} style={{ color: '#5f6b63' }} />
                          {item.label}
                        </Link>
                      ))}
                      <div style={{ borderTop: '1px solid #e4e9e5', margin: '4px 0' }} />
                      <button
                        onClick={signOut}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-sm text-left"
                        style={{ color: '#46534c' }}
                      >
                        <LogOut size={16} style={{ color: '#5f6b63' }} />
                        Log out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Link
                    href={user?.role ? dashboardPath(user.role) : '/dashboard'}
                    style={{
                      padding: '10px 16px', borderRadius: 999,
                      backgroundColor: '#047246', color: 'white',
                      fontSize: 14, fontWeight: 600, textDecoration: 'none',
                    }}
                  >
                    {displayName?.split(' ')[0] || 'Dashboard'}
                  </Link>
                  <button
                    onClick={signOut}
                    className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg transition-colors hover:bg-gray-50"
                    style={{ color: '#46534c' }}
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </>
              )
            ) : (
              <>
                <button
                  onClick={() => setAuthMode('signin')}
                  style={{
                    padding: '10px 16px', borderRadius: 999,
                    border: '1.5px solid #e4e9e5', color: '#14201a',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    backgroundColor: 'transparent', fontFamily: 'inherit',
                  }}
                >
                  Sign in
                </button>
                <button
                  onClick={() => setAuthMode('signup')}
                  style={{
                    padding: '10px 16px', borderRadius: 999, border: 'none',
                    backgroundColor: '#047246', color: 'white',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Sign up
                </button>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden"
            style={{ color: '#46534c', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={24} />
          </button>
        </div>
      </header>

      {/* Sticky "your renewal needs action" bar — logged-in customers only */}
      <CustomerRenewalBanner />

      {/* Mobile drawer */}
      {drawerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} className="md:hidden">
          <div
            style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)' }}
            onClick={() => setDrawerOpen(false)}
          />
          <div
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: 280,
              backgroundColor: 'white', boxShadow: '0 0 60px rgba(0,0,0,0.2)',
              display: 'flex', flexDirection: 'column', padding: 24,
            }}
          >
            <button
              onClick={() => setDrawerOpen(false)}
              style={{ alignSelf: 'flex-end', marginBottom: 24, color: '#46534c', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {isAuthenticated ? (
                <>
                  <Link
                    href={user?.role ? dashboardPath(user.role) : '/dashboard'}
                    onClick={() => setDrawerOpen(false)}
                    style={{
                      padding: '12px 16px', borderRadius: 999, backgroundColor: '#047246',
                      color: 'white', fontWeight: 600, textAlign: 'center', textDecoration: 'none',
                    }}
                  >
                    Dashboard
                  </Link>
                  <button
                    onClick={() => { setDrawerOpen(false); signOut(); }}
                    style={{
                      padding: '12px 16px', borderRadius: 999, border: '1px solid #e4e9e5',
                      backgroundColor: 'white', color: '#46534c', fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setDrawerOpen(false); setAuthMode('signup'); }}
                    style={{
                      padding: '12px 16px', borderRadius: 999, backgroundColor: '#047246', border: 'none',
                      color: 'white', fontWeight: 600, textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Sign up
                  </button>
                  <button
                    onClick={() => { setDrawerOpen(false); setAuthMode('signin'); }}
                    style={{
                      padding: '12px 16px', borderRadius: 999, border: '1px solid #e4e9e5',
                      backgroundColor: 'white', color: '#46534c', fontWeight: 600,
                      textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Auth popup — sign in (OTP) / sign up (role choice) */}
      {authMode && (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onModeChange={setAuthMode}
        />
      )}
    </>
  );
}
