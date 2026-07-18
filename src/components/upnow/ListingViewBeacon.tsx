'use client';

/**
 * Anonymous public-listing view beacon. Mounted on /listings/units/[id];
 * fires one POST per page load to /api/track/listing (no auth required —
 * prospects are the point). Fire-and-forget: tracking must never affect
 * the visitor's experience.
 */
import { useEffect } from 'react';

export default function ListingViewBeacon({ unitId }: { unitId: number }) {
  useEffect(() => {
    if (!Number.isInteger(unitId) || unitId <= 0) return;
    void fetch('/api/track/listing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitId }),
      keepalive: true,
    }).catch(() => null);
  }, [unitId]);

  return null;
}
