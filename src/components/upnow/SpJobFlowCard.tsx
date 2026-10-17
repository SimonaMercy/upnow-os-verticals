'use client';

/**
 * SpJobFlowCard — "Job flow" on the service-provider overview: the fixed-price and quote
 * flows as stage strips, counted from the bookings the overview already loads (read-only).
 * Each stage links to the Operations board lane it is worked in. With no bookings the
 * strips still render (zeros + a one-line meaning per stage) so the flow is always visible.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { StageStrip, type StripStage } from '@/components/os/StageStrip';
import { FIXED_FLOW, QUOTE_FLOW, countJobFlow, type FlowStageDef } from '@/lib/homeServices/jobFlow';
import type { PipelineBooking } from '@/lib/homeServices/spPipeline';

const OPS = '/dashboard/service-provider/operations';

const toStrip = (defs: FlowStageDef[], counts: Record<string, number>): StripStage[] =>
  defs.map((d) => ({
    key: d.key, label: d.label, hint: d.hint, count: counts[d.key] ?? 0,
    href: `${OPS}?tab=${d.tab}`, attention: d.attention,
  }));

export function SpJobFlowCard({ bookings, loading = false }: { bookings: PipelineBooking[]; loading?: boolean }) {
  const counts = useMemo(() => countJobFlow(bookings), [bookings]);
  const total = bookings.length - counts.cancelled;
  return (
    <section style={{ background: '#fff', border: '1px solid #e3e7e4', borderRadius: 16, padding: '16px 18px 18px', marginBottom: 24 }}
      aria-labelledby="sp-job-flow-title">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 id="sp-job-flow-title" style={{ fontSize: 15, fontWeight: 700, color: '#14201a', margin: 0 }}>Job flow</h2>
          <p style={{ fontSize: 12, color: '#5f6b63', margin: '3px 0 0' }}>
            {loading ? 'Loading your bookings…'
              : total > 0 ? `${total} open or recent job${total === 1 ? '' : 's'} across both flows. Open a stage to work it on the board.`
              : 'No bookings yet — this is how every job will move. Each stage opens its lane on the Operations board.'}
          </p>
        </div>
        <Link href={OPS} style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#0b7a4e', borderRadius: 9, padding: '7px 13px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Open Operations board
        </Link>
      </div>

      <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#5f6b63', margin: '4px 0 8px' }}>
        Fixed-price jobs <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>· cleaning, handyman, set-price services</span>
      </h3>
      <StageStrip ariaLabel="Fixed-price job flow" stages={toStrip(FIXED_FLOW, counts.fixed)} loading={loading} />

      <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#5f6b63', margin: '16px 0 8px' }}>
        Quote jobs <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>· inspect first, then quote (AC, repairs)</span>
      </h3>
      <StageStrip ariaLabel="Quote job flow" stages={toStrip(QUOTE_FLOW, counts.quote)} loading={loading} />

      {counts.cancelled > 0 && (
        <p style={{ fontSize: 11.5, color: '#6b756f', margin: '10px 0 0' }}>
          {counts.cancelled} cancelled booking{counts.cancelled === 1 ? '' : 's'} not counted here.
        </p>
      )}
    </section>
  );
}
