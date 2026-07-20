'use client';

/**
 * Anonymous public page-visit beacon. Mounted once via SiteHeader, so it covers
 * every outer marketplace page (landing, /services, /listings, …). Posts one
 * event per client-side route change to /api/track/visit (page_visits, migration
 * 0155) with any UTM parameters + referrer, so traffic can be attributed.
 *
 * Fire-and-forget with keepalive; a tracking failure never surfaces. Deduped per
 * pathname so re-renders / React strict-mode don't double-count.
 */
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { getSessionId } from '@/lib/trackingIds';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

export function PublicPageTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === last.current) return; // dedupe re-renders / strict-mode
    last.current = pathname;

    // Read UTM from the live URL (SiteHeader only strips the `auth` param, never UTM).
    const params = new URLSearchParams(window.location.search);
    const payload: Record<string, string> = { path: pathname };
    for (const k of UTM_KEYS) {
      const v = params.get(k);
      if (v) payload[k] = v;
    }
    if (document.referrer) payload.referrer = document.referrer;
    const sid = getSessionId();
    if (sid) payload.session_id = sid;

    try {
      void fetch('/api/track/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* telemetry never throws */
    }
  }, [pathname]);

  return null;
}
