/**
 * /dashboard/customer/spaces — thin redirector.
 *
 * The legacy list/cards UX has been retired; the v2 detail page at
 * /dashboard/customer/spaces/v2/[spaceKey] is now the primary surface.
 *
 * This route picks the customer's most-recent viewing/contract and forwards
 * the browser straight to that v2 view. If they have no spaces yet, we show
 * a small empty state pointing back to the listings page.
 *
 * Keeping the route file (instead of deleting it) preserves every existing
 * link / bookmark / sidebar entry that still points at /spaces — they all
 * land on the right v2 view automatically.
 */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';

interface MyViewing {
  id: number;
  leadId: number;
  scheduledAt?: string | null;
  status?: string | null;
  lead?: { id: number; stage?: string | null } | null;
}

type LoadState = 'loading' | 'empty' | 'failed';

export default function CustomerSpacesIndexRedirect() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/leads/my-viewings', { credentials: 'include' });
        if (!res.ok) throw new Error(`Viewings fetch ${res.status}`);
        const viewings = await res.json() as MyViewing[];
        if (cancelled) return;
        if (!Array.isArray(viewings) || viewings.length === 0) {
          setState('empty');
          return;
        }
        // Pick the most recent viewing — covers booked / progressing / active.
        // Each card on the old list page mapped to `v-${leadId}`, so we use
        // the same key here for parity with notification deep-links.
        const sorted = viewings.slice().sort((a, b) => {
          const ad = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
          const bd = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
          return bd - ad;
        });
        const leadId = sorted[0].leadId ?? sorted[0].lead?.id ?? null;
        if (!leadId) { setState('empty'); return; }
        router.replace(`/dashboard/customer/spaces/v2/v-${leadId}`);
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (state === 'empty') {
    return (
      <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
        <div style={{ maxWidth: 420, textAlign: 'center', display: 'grid', gap: 14, justifyItems: 'center' }}>
          <span style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--mist, #ede9e3)', display: 'grid', placeItems: 'center' }}>
            <Building2 size={26} style={{ color: 'var(--mute, #9b9890)' }} />
          </span>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink, #1a1916)', margin: 0 }}>No spaces yet</h1>
          <p style={{ fontSize: 14, color: 'var(--ink-2, #4a4944)', margin: 0, lineHeight: 1.5 }}>
            Once you book a viewing or apply for a unit it’ll appear here. Start by exploring what’s available.
          </p>
          <Link
            href="/listings"
            style={{
              marginTop: 4, padding: '10px 22px', borderRadius: 12,
              background: 'var(--ink, #1a1916)', color: 'var(--paper, #fff)',
              fontSize: 14, fontWeight: 700, textDecoration: 'none',
            }}
          >
            Browse listings
          </Link>
        </div>
      </main>
    );
  }

  if (state === 'failed') {
    return (
      <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
        <div style={{ maxWidth: 420, textAlign: 'center', display: 'grid', gap: 10, justifyItems: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink, #1a1916)', margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-2, #4a4944)', margin: 0, lineHeight: 1.5 }}>
            We couldn’t load your spaces. Refresh the page or try again in a moment.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--mute, #9b9890)', fontSize: 13 }}>
        <Loader2 size={16} className="animate-spin" />
        Loading your space…
      </div>
    </main>
  );
}
