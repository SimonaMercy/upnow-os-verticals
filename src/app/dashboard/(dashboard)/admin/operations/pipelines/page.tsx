'use client';

/**
 * Admin pipeline boards (SP-260) — the breadth view: the SAME four pipelines
 * and eleven stages the provider sees (shared stage model via
 * SpOperationsPipelines adminLens), spanning every provider, with area
 * (emirate) allocation, provider/category filters, and a live provider-load
 * strip (active jobs vs max_concurrent_jobs). Cards deep-link into the
 * SP-257 per-booking drill-down. Actions (assign/reassign) stay on the
 * dispatch queue and the drill-down — this surface is oversight.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import SpOperationsPipelines from '@/components/upnow/SpOperationsPipelines';

const PRIMARY = '#2e9f82';
const INK = '#1a1916';
const MUTE = '#6b6860';
const FAINT = '#9b9890';
const BORDER = '1px solid #ececea';

interface LoadBooking { id: number; status: string; serviceProviderId: number | null }
interface Provider { id: number; businessName: string; compliant: boolean; jobReady: boolean; maxConcurrentJobs: number | null; technicians: { id: number; name: string }[] }

const ACTIVE = new Set(['assigned', 'en_route', 'in_progress']);

export default function AdminPipelinesPage() {
  const [bookings, setBookings] = useState<LoadBooking[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);

  useEffect(() => {
    void Promise.all([
      apiGet<LoadBooking[] | { data?: LoadBooking[] }>('/bookings').then((b) => (Array.isArray(b) ? b : (b?.data ?? []))).catch(() => [] as LoadBooking[]),
      apiGet<Provider[]>('/bookings/providers').catch(() => [] as Provider[]),
    ]).then(([b, p]) => { setBookings(b); setProviders(p); });
  }, []);

  // Live load per provider: jobs currently on the road vs their concurrency
  // ceiling. Busiest first; only providers with at least one live or possible
  // job (job-ready or loaded) earn a card.
  const load = useMemo(() => {
    const counts = new Map<number, number>();
    for (const b of bookings) {
      if (b.serviceProviderId != null && ACTIVE.has(b.status)) {
        counts.set(b.serviceProviderId, (counts.get(b.serviceProviderId) ?? 0) + 1);
      }
    }
    return providers
      .map((p) => ({ ...p, active: counts.get(p.id) ?? 0 }))
      .filter((p) => p.active > 0 || p.jobReady)
      .sort((a, b) => b.active - a.active || a.businessName.localeCompare(b.businessName));
  }, [bookings, providers]);

  return (
    <div>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '8px 4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/dashboard/admin/operations" style={{ fontSize: 12.5, color: PRIMARY, fontWeight: 600 }}>← Dispatch queue</Link>
        </div>

        {load.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>
              Provider load — live jobs vs capacity
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {load.map((p) => {
                const cap = p.maxConcurrentJobs;
                const over = cap != null && p.active >= cap;
                return (
                  <div key={p.id} style={{ border: BORDER, borderRadius: 12, padding: '8px 13px', background: '#fff', borderColor: over ? '#f3c6c6' : '#ececea' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>{p.businessName}</div>
                    <div style={{ fontSize: 11.5, color: over ? '#b42318' : MUTE, marginTop: 1 }}>
                      {p.active} active{cap != null ? ` / ${cap} max` : ''}{over ? ' · at capacity' : ''}
                      {!p.jobReady ? ' · not job-ready' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* The shared stage model — identical pipelines/stage names to the
          provider board, so both sides call the same thing the same name. */}
      <SpOperationsPipelines
        adminLens
        bookingsPath="/bookings"
        bookingHref={(id) => `/dashboard/admin/operations/${id}`}
      />
    </div>
  );
}
