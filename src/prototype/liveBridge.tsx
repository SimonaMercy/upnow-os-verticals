'use client';

/**
 * PROTOTYPE ONLY — hosts the real production Spaces screens inside the new OS.
 *
 * Production pages are mirrored under /prototype/os/rp/** by one-line
 * re-export route files (the manager portal's pattern), so they run unchanged
 * with real data from the configured backend. This bridge keeps navigation
 * inside the new shell:
 *   - links to /rental-provider/dashboard/... are caught on click, and
 *   - programmatic router.push/replace from those screens is rewritten via a
 *     wrapped AppRouterContext (what next/navigation's useRouter() reads).
 * No production file is modified.
 */
import { useMemo, type ReactNode, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { Database, LogIn, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toBridge } from './nav';


export function LiveBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  const wrapped = useMemo(() => ({
    ...router,
    push: (href: string, opts?: Parameters<typeof router.push>[1]) => router.push(toBridge(href), opts),
    replace: (href: string, opts?: Parameters<typeof router.replace>[1]) => router.replace(toBridge(href), opts),
    prefetch: (href: string, opts?: Parameters<typeof router.prefetch>[1]) => router.prefetch(toBridge(href), opts),
  }), [router]);

  // <Link> navigates through Next's internals, not the context, so catch its clicks here (capture phase).
  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const next = toBridge(href);
    if (next === href) return;
    e.preventDefault();
    e.stopPropagation();
    router.push(next);
  }

  return (
    <AppRouterContext.Provider value={wrapped}>
      <div onClickCapture={onClickCapture}>{children}</div>
    </AppRouterContext.Provider>
  );
}

/** Tells the presenter whether the embedded production screens can load real data. */
export function LiveStatus() {
  const { user, loading } = useAuth();
  if (loading) return null;
  const tone = user?.role === 'rental_provider' ? 'ok' : 'warn';
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] ${tone === 'ok' ? 'bg-[var(--g1)] text-[var(--g8)]' : 'bg-[#fbf0dc] text-[#8a5a14]'}`}>
      {tone === 'ok' ? <Database className="h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1">
        <strong>Live production screen</strong> — real data, unchanged OS functionality.{' '}
        {user
          ? user.role === 'rental_provider'
            ? <>Signed in as {user.name}.</>
            : <>Signed in as a {user.role.replace('_', ' ')}; Spaces data needs a rental-provider account.</>
          : <>Not signed in, so this screen cannot load data.</>}
      </span>
      {user?.role !== 'rental_provider' && (
        <>
          <a href="/login" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 font-bold text-[var(--g8)] ring-1 ring-[var(--line2)] hover:ring-[var(--g6)]">
            <LogIn className="h-3.5 w-3.5" aria-hidden />Sign in as a rental provider
          </a>
          <span className="w-full text-[12px] opacity-80">Sign-in opens in a new tab (the session is shared). Then come back here and refresh.</span>
        </>
      )}
    </div>
  );
}
