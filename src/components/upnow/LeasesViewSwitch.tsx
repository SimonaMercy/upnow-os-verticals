/**
 * Monthly | Yearly switch shown in the header of Leases - Monthly and Lease
 * Summary - Yearly. The two stay separate pages with their own data — this only
 * navigates between them, carrying the shared filters (year, buildings, lease
 * types) in the query so the other page opens on the same selection.
 */
'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export const LEASES_SLUG = { monthly: 'leases-by-year', yearly: 'new-leases-matrix' } as const;
export type LeasesView = keyof typeof LEASES_SLUG;

export function LeasesViewSwitch({ current, year, buildings, leaseTypes, allLeaseTypes, reportsBase, onSwitch }: {
  current: LeasesView;
  year: number;
  buildings: number[];
  leaseTypes: string[];
  allLeaseTypes: number;
  /** Route prefix of the reports hub, e.g. /rental-provider/dashboard/reports. */
  reportsBase?: string;
  /** Overrides navigation (the manager portal opens reports by state, not route). */
  onSwitch?: (slug: string, query: URLSearchParams) => void;
}) {
  const router = useRouter();
  const go = (view: LeasesView) => {
    if (view === current) return;
    const q = new URLSearchParams();
    q.set('year', String(year));
    if (buildings.length) q.set('buildings', buildings.join(','));
    if (leaseTypes.length > 0 && leaseTypes.length < allLeaseTypes) q.set('leaseTypes', leaseTypes.join(','));
    const slug = LEASES_SLUG[view];
    if (onSwitch) onSwitch(slug, q);
    else router.push(`${reportsBase ?? '/rental-provider/dashboard/reports'}/${slug}?${q.toString()}`);
  };
  return (
    <div className="inline-flex shrink-0 rounded-full border border-[#e4e9e5] bg-white p-0.5 print:hidden" role="tablist" aria-label="Report view">
      {(['monthly', 'yearly'] as const).map(v => (
        <button key={v} type="button" role="tab" aria-selected={current === v} onClick={() => go(v)}
          title={v === 'monthly' ? 'Leases – Monthly: every lease, grouped by the month it started' : 'Lease Summary – Yearly: new leases per property, month by month'}
          className={cn('h-7 px-3 rounded-full text-[13px] font-semibold transition-colors',
            current === v ? 'bg-[#0b3d2a] text-white' : 'text-[#46534c] hover:text-[#14201a] hover:bg-[#f4faf7]')}>
          {v === 'monthly' ? 'Monthly' : 'Yearly'}
        </button>
      ))}
    </div>
  );
}
