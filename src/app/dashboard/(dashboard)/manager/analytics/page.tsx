/**
 * Manager Analytics — FULL parity with the landlord Analytics page, scoped per
 * landlord. Renders the shared ExecutiveOverview (KPI tiles, exceptions strip,
 * charts) against /api/manager/reports/executive-summary?rp=N.
 *
 * Gated by the same canViewReports permission the nav enforces. Exception chips
 * deep-link into the matching report on the manager Reports page (inline ?slug=).
 */
'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarRange, Lock, BarChart2 } from 'lucide-react';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { useReportsYear, setReportsYear, REPORT_YEARS } from '@/components/upnow/reportsYear';
import ExecutiveOverview from '@/app/rental-provider/dashboard/reports/ExecutiveOverview';

export default function ManagerAnalyticsPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');

  // Effective landlord = the one chosen in the LandlordSwitcher, else the first
  // managed landlord that delegated reports access.
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canViewReports)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canViewReports', effectiveRp);

  const year = useReportsYear();

  // Per-landlord permission gate — mirrors the lock the nav enforces.
  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-[460px] text-center bg-white border border-[#e4e9e5] rounded-2xl px-7 py-10 mt-10">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#14201a]">Permission required</p>
          <p className="text-sm text-[#5f6b63] mt-1.5 leading-relaxed">
            This landlord hasn&rsquo;t granted you the <strong>View Reports</strong> permission, so their analytics aren&rsquo;t available.
          </p>
        </div>
      </div>
    );
  }
  if (effectiveRp == null) return null;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#14201a]">Analytics</h1>
          <p className="text-sm text-[#5f6b63] mt-0.5">
            Where this landlord&rsquo;s portfolio stands right now — KPIs, exceptions and trends at a glance.{' '}
            <Link href={`/dashboard/manager/reports?rp=${effectiveRp}`} className="text-[#047246] font-medium hover:underline inline-flex items-center gap-1">
              <BarChart2 size={12} /> Browse reports
            </Link>
          </p>
        </div>
        {/* Hub-wide year — shared with the Reports page. Scopes the cashflow &
            collection figures below (the headline snapshot tiles ignore it). */}
        <label className="inline-flex items-center gap-2 bg-white border border-[#e4e9e5] rounded-xl pl-3 pr-2 py-1.5 shadow-sm">
          <CalendarRange size={15} className="text-[#047246]" />
          <span className="text-xs font-medium text-[#5f6b63]">Year</span>
          <select
            value={year === 'all' ? 'all' : String(year)}
            onChange={e => setReportsYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="text-sm font-semibold text-[#14201a] bg-transparent focus:outline-none cursor-pointer pr-1"
            aria-label="Analytics year">
            {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            <option value="all">All years</option>
          </select>
        </label>
      </div>

      <ExecutiveOverview
        endpoint={`/api/manager/reports/executive-summary?rp=${effectiveRp}`}
        linkFor={(slug) => `/dashboard/manager/reports?rp=${effectiveRp}&slug=${slug}`}
        year={year}
      />
    </div>
  );
}
