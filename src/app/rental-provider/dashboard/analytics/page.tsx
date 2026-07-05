/**
 * Analytics — the CEO "where do I stand" dashboard: headline KPI tiles, the
 * red/amber exceptions strip and the four trend charts (ExecutiveOverview).
 *
 * Split out of the Reports hub so Reports lists the drillable/exportable reports
 * and Analytics carries the at-a-glance overview. The hub-wide Year filter is a
 * shared localStorage store (see reportsYear.ts) so the choice is the same on
 * both pages; here it scopes the cashflow & collection figures. Exception chips
 * deep-link into the matching report on the Reports page (ExecutiveOverview's
 * default linkFor already points at /rental-provider/dashboard/reports/<slug>).
 */
'use client';

import Link from 'next/link';
import { CalendarRange, BarChart2 } from 'lucide-react';
import ExecutiveOverview from '../reports/ExecutiveOverview';
import { useReportsYear, setReportsYear, REPORT_YEARS } from '@/components/upnow/reportsYear';

export default function AnalyticsPage() {
  const year = useReportsYear();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Analytics</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">
            Where the portfolio stands right now — KPIs, exceptions and trends at a glance.{' '}
            <Link href="/rental-provider/dashboard/reports" className="text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">
              <BarChart2 size={12} /> Browse reports
            </Link>
          </p>
        </div>
        {/* Hub-wide year — shared with the Reports page. Scopes the cashflow &
            collection figures below (the headline snapshot tiles ignore it). */}
        <label className="inline-flex items-center gap-2 bg-white border border-[#e8e6e0] rounded-xl pl-3 pr-2 py-1.5 shadow-sm">
          <CalendarRange size={15} className="text-[#2e9f82]" />
          <span className="text-xs font-medium text-[#6b6860]">Year</span>
          <select
            value={year === 'all' ? 'all' : String(year)}
            onChange={e => setReportsYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="text-sm font-semibold text-[#1a1916] bg-transparent focus:outline-none cursor-pointer pr-1"
            aria-label="Analytics year">
            {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            <option value="all">All years</option>
          </select>
        </label>
      </div>

      {/* Executive overview — KPI tiles, exceptions strip, charts */}
      <ExecutiveOverview year={year} />
    </div>
  );
}
