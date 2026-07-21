'use client';

/**
 * Presence beacon — posts one event per client-side route change to
 * /api/track/page (page_views table, migration 0126). Client-side navigation
 * never hits a write endpoint, so without this a user's browsing (lease pages
 * opened, reports read) is invisible to the activity layer.
 *
 * Fire-and-forget with keepalive; a tracking failure never surfaces. Mounted
 * once per dashboard layout with the portal it belongs to.
 */
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { getSessionId } from '@/lib/trackingIds';

export function PageViewTracker({ portal }: { portal: 'rp' | 'manager' | 'customer' | 'admin' | 'service_provider' | 'technician' }) {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === last.current) return; // strict-mode / re-render dedupe
    last.current = pathname;
    try {
      void fetch('/api/track/page', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathname, portal, session_id: getSessionId() || undefined }),
        keepalive: true,
      }).catch(() => undefined);
    } catch { /* telemetry never throws */ }
  }, [pathname, portal]);

  return null;
}
