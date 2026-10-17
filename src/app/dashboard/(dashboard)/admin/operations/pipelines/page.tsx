'use client';

/**
 * Admin › Operations › Pipeline boards (SP-260) — the breadth view: the SAME four pipelines
 * and eleven stages the provider sees (shared stage model via SpOperationsPipelines
 * adminLens), spanning every provider, with area (emirate) allocation, provider/category
 * filters, and a live provider-load strip (active jobs vs max_concurrent_jobs). Cards
 * deep-link into the SP-257 per-booking drill-down. Actions (assign/reassign) stay on the
 * dispatch queue and the drill-down — this surface is oversight.
 *
 * Parity with previous page (every item kept):
 *  - GET /api/bookings (array or { data }) and GET /api/bookings/providers — both
 *    failure-tolerant (empty lists) — for the provider-load strip.
 *  - Provider load: active = assigned / en_route / in_progress per provider; only providers
 *    with live jobs or job-ready; busiest first, then name; "N active / cap max",
 *    "at capacity" (active ≥ cap), "not job-ready". Now a kit table with pills.
 *  - <SlaBreachStrip/> (SP-253) — REUSED unchanged.
 *  - <SpOperationsPipelines adminLens bookingsPath="/bookings"
 *    bookingHref={(id) => /dashboard/admin/operations/:id}/> — REUSED unchanged (it owns the
 *    boards, area allocation, provider/category filters).
 *  - "← Dispatch queue" link → /dashboard/admin/operations (now a labelled head action).
 */

import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api';
import SpOperationsPipelines from '@/components/upnow/SpOperationsPipelines';
import { SlaBreachStrip } from '@/components/upnow/SlaBreachStrip';
import { Btn, Card, OsPage, PageHead, Pill, ScopeStrip } from '@/components/os/kit';

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

  // Live load per provider: jobs currently on the road vs their concurrency ceiling.
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
  const atCap = load.filter((p) => p.maxConcurrentJobs != null && p.active >= p.maxConcurrentJobs).length;

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Operations"
        title="Pipeline boards"
        lede="Every provider's jobs on the same stage model the provider sees — oversight only. Assign and reassign from the dispatch queue or the job drill-down."
        actions={<Btn href="/dashboard/admin/operations">Dispatch queue</Btn>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: 'Home services' },
        { label: 'Providers on load', value: load.length },
        { label: 'At capacity', value: atCap },
      ]} />

      {/* SP-253 · needs attention: SLA breaches recorded by the minute cron */}
      <SlaBreachStrip />

      {load.length > 0 && (
        <div style={{ margin: '14px 0' }}>
          <Card title="Provider load" sub="Live jobs vs capacity — busiest first">
            <div className="gx-tbl-scroll">
              <table className="gx-tbl">
                <thead><tr><th>Provider</th><th className="num">Active</th><th className="num">Max concurrent</th><th>State</th></tr></thead>
                <tbody>
                  {load.map((p) => {
                    const cap = p.maxConcurrentJobs;
                    const over = cap != null && p.active >= cap;
                    return (
                      <tr key={p.id}>
                        <td className="strong">{p.businessName}</td>
                        <td className="num">{p.active}</td>
                        <td className="num">{cap ?? '—'}</td>
                        <td className="nowrap">
                          {over ? <Pill tone="danger">At capacity</Pill> : <Pill tone="primary">Has capacity</Pill>}
                          {!p.jobReady && <> <Pill tone="amber">Not job-ready</Pill></>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* The shared stage model — identical pipelines/stage names to the provider board. */}
      <SpOperationsPipelines
        adminLens
        bookingsPath="/bookings"
        bookingHref={(id) => `/dashboard/admin/operations/${id}`}
      />
    </OsPage>
  );
}
