'use client';

/**
 * Demo clock for the PREVIEW booking engine — lets reviewers move time forward to watch
 * requests expire, offers lapse, holds release and payouts fall due. Shown under the
 * PreviewBanner on the inbox, boards and calendar. Labelled buttons only.
 */
import { Clock } from 'lucide-react';
import { Btn, PreviewBanner } from '@/components/os/kit';
import { HOUR_MS, DAY_MS, formatDuration } from '@/lib/os/bookings/engine';
import { useBookings, useNow } from '@/lib/os/bookings/store';
import { fmtDT } from './shared';

export function DemoClock() {
  const { advanceClock, resetDemo, clockOffsetMs } = useBookings();
  const now = useNow(15_000);
  return (
    <div
      className="gx-btn-row"
      role="group"
      aria-label="Demo clock"
      style={{ marginTop: -6, marginBottom: 14, padding: '7px 12px', borderRadius: 10, border: '1px dashed #d9b46a', background: '#fffaf0', fontSize: 11.5, color: '#7a5410' }}
    >
      <Clock size={14} aria-hidden />
      <span><strong>Demo time (Dubai):</strong> {fmtDT(now)}</span>
      <span style={{ opacity: 0.8 }}>{clockOffsetMs > 0 ? `· ${formatDuration(clockOffsetMs)} ahead of real time` : '· real time'}</span>
      <span style={{ flex: 1 }} />
      <Btn size="xs" onClick={() => advanceClock(HOUR_MS)}>+1 hour</Btn>
      <Btn size="xs" onClick={() => advanceClock(DAY_MS)}>+1 day</Btn>
      <Btn size="xs" variant="danger" onClick={() => resetDemo()}>Reset demo</Btn>
    </div>
  );
}

/** PreviewBanner wording for the booking engine + the demo clock under it. */
export function BookingsPreview() {
  return (
    <>
      <PreviewBanner>
        Short stays, venues, courts and charters have no backend yet. These bookings are demonstration data kept in this
        browser (shared across your tabs) — nothing is sent to UpNow or to customers.
      </PreviewBanner>
      <DemoClock />
    </>
  );
}
