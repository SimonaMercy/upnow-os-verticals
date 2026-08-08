/**
 * Manager Reports — FULL parity with the landlord hub, scoped per landlord.
 *
 * Same shared pieces as /rental-provider/dashboard/reports:
 *   - reportCatalog          (GROUPS + REPORT_TILES — one list, no drift)
 *   - ReportDetailView       (endpointBase /api/manager/reports, extraQuery rp=N)
 *   - DataGapsView           (endpoint /api/manager/reports/data-gaps?rp=N)
 *   - DataExports            (Excel dataset downloads, scoped rp=N)
 *
 * The KPIs / exceptions / charts (ExecutiveOverview) live on the sibling
 * Analytics page (/dashboard/manager/analytics).
 *
 * Navigation stays inline (?rp=N&slug=x) — the manager portal has no per-slug
 * routes; exception chips and tiles set the slug query param.
 */
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Search, X, BarChart2, Lock, CalendarRange, LineChart } from 'lucide-react';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';
import { useReportsYear, setReportsYear, REPORT_YEARS } from '@/components/upnow/reportsYear';
import DataExports from '@/app/rental-provider/dashboard/reports/DataExports';
import ReportSheetView, { SHEET_SLUGS, type SheetSlug } from '@/components/upnow/ReportSheetView';
import { GROUPS, REPORT_TILES } from '@/components/upnow/reportCatalog';
import { ReportDetailView } from '@/components/upnow/ReportDetailView';
import { MoveOutReasonsReport } from '@/components/upnow/MoveOutReasonsReport';
import { OperationsByStageReport } from '@/components/upnow/OperationsByStageReport';
import { LeaseRevenueByYearReport } from '@/components/upnow/LeaseRevenueByYearReport';
import { DataGapsView } from '@/components/upnow/DataGapsView';
import { MissingDataView, MISSING_REPORTS } from '@/components/upnow/MissingDataView';

export default function ManagerReportsPage() {
  // Scoped to the landlord chosen in the LandlordSwitcher (?rp=). Under "All
  // landlords" with several to choose from, prompt for one rather than showing
  // an arbitrary landlord's reports.
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canViewReports');
  const router = useRouter();
  const searchParams = useSearchParams();
  const slugParam = searchParams.get('slug');

  const year = useReportsYear();
  const [search, setSearch] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(slugParam);

  // Keep the open report in sync with the URL (exception chips navigate via
  // ?slug=). The landlord switcher preserves ?slug=, so switching landlord
  // re-scopes the SAME report to the new landlord — its child re-fetches via
  // extraQuery=rp — instead of dropping back to the grid.
  useEffect(() => { setOpenSlug(slugParam); }, [slugParam, effectiveRp]);

  const navigate = (slug: string | null) => {
    setOpenSlug(slug);
    const qs = new URLSearchParams();
    if (effectiveRp != null) qs.set('rp', String(effectiveRp));
    if (slug) qs.set('slug', slug);
    router.replace(`/dashboard/manager/reports?${qs.toString()}`);
  };

  if (!permsLoading && needsLandlord) {
    return <SelectLandlordNotice resource="Reports" />;
  }

  // Per-landlord permission gate — mirrors the lock the nav enforces.
  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-[460px] text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-10">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            This landlord hasn&rsquo;t granted you the <strong>View Reports</strong> permission, so their reports aren&rsquo;t available.
          </p>
        </div>
      </div>
    );
  }
  if (effectiveRp == null) return null;

  // ── Drill-down: one report rendered inline, scoped to the landlord ──
  if (openSlug === 'data-gaps') {
    return (
      <DataGapsView
        endpoint={`/api/manager/reports/data-gaps?rp=${effectiveRp}`}
        onBack={() => navigate(null)}
      />
    );
  }
  if (openSlug && MISSING_REPORTS[openSlug]) {
    return (
      <MissingDataView
        config={MISSING_REPORTS[openSlug]}
        endpoint={`/api/manager/reports/${openSlug}?rp=${effectiveRp}`}
        onBack={() => navigate(null)}
        scopeToggle={openSlug === 'missing-customers'}
      />
    );
  }
  // Leasing Funnel — same per-manager month-sheet + drill-down component, scoped
  // server-side to this manager's own responsible-manager funnel. Placed before
  // the SHEET_SLUGS check so it renders the interactive component, not a sheet.
  if (openSlug === 'leasing-funnel') {
    return (
      <OperationsByStageReport
        endpointBase="/api/manager/reports"
        reportPath="leasing-funnel"
        title="Leasing Funnel by Manager"
        csvBase="leasing-funnel"
        subtitleScoped="The contracts you ran reaching each stage of the leasing journey — lead to settlement — month by month. Click any number for the records behind it. Signatures marked “on file” are never counted."
        extraQuery={`rp=${effectiveRp}`}
        onBack={() => navigate(null)}
        contractsBase="/dashboard/manager/contracts"
        leadsBase="/dashboard/manager/leads"
      />
    );
  }
  // The two headline reports render as exportable month sheets, each on its own
  // slug — the manager per-report allow-list gates them server-side like any
  // other report.
  if (openSlug && (SHEET_SLUGS as string[]).includes(openSlug)) {
    return (
      <ReportSheetView
        slug={openSlug as SheetSlug}
        endpointBase="/api/manager/reports"
        extraQuery={`rp=${effectiveRp}`}
        onBack={() => navigate(null)}
      />
    );
  }
  // Operations by stage renders its own matrix component (not a standard table),
  // scoped server-side to this manager's own activity and operation pipeline.
  if (openSlug === 'operations-by-stage') {
    return (
      <OperationsByStageReport
        endpointBase="/api/manager/reports"
        extraQuery={`rp=${effectiveRp}`}
        onBack={() => navigate(null)}
        contractsBase="/dashboard/manager/contracts"
        leadsBase="/dashboard/manager/leads"
      />
    );
  }
  // Move-out Reasons renders its own chart + drill-down component, scoped to
  // this managed landlord's book via rp=N.
  if (openSlug === 'move-out-reasons') {
    return (
      <MoveOutReasonsReport
        endpointBase="/api/manager/reports"
        extraQuery={`rp=${effectiveRp}`}
        onBack={() => navigate(null)}
        managerRp={effectiveRp}
      />
    );
  }
  // Lease Revenue by Year renders its own two-section component (not a standard
  // table), scoped to this managed landlord's book via rp=N.
  if (openSlug === 'lease-revenue-by-year') {
    return (
      <LeaseRevenueByYearReport
        endpointBase="/api/manager/reports"
        extraQuery={`rp=${effectiveRp}`}
        onBack={() => navigate(null)}
        contractsBase="/dashboard/manager/contracts"
      />
    );
  }
  if (openSlug) {
    return (
      <ReportDetailView
        slug={openSlug}
        endpointBase="/api/manager/reports"
        extraQuery={`rp=${effectiveRp}`}
        onBack={() => navigate(null)}
        contractsBase="/dashboard/manager/contracts"
      />
    );
  }

  // ── Hub: executive overview + grouped catalog (same as the RP hub) ──
  const filtered = REPORT_TILES.filter(r =>
    !r.rpOnly // landlord-only reports (e.g. Manager Performance) never appear here
    && !r.hidden
    && (r.title.toLowerCase().includes(search.toLowerCase())
      || r.description.toLowerCase().includes(search.toLowerCase())),
  );
  const sections = GROUPS
    .map(g => ({ ...g, tiles: filtered.filter(r => r.group === g.key) }))
    .filter(g => g.tiles.length > 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Reports</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">
            Open any report to view, filter and export it.{' '}
            <Link href={`/dashboard/manager/analytics?rp=${effectiveRp}`} className="text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">
              <LineChart size={12} /> View analytics
            </Link>
          </p>
        </div>
        {/* Hub-wide year — scopes the overview and the default period each
            time-based report opens with (snapshots ignore it). */}
        <label className="inline-flex items-center gap-2 bg-white border border-[#e8e6e0] rounded-xl pl-3 pr-2 py-1.5 shadow-sm">
          <CalendarRange size={15} className="text-[#2e9f82]" />
          <span className="text-xs font-medium text-[#6b6860]">Year</span>
          <select
            value={year === 'all' ? 'all' : String(year)}
            onChange={e => setReportsYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="text-sm font-semibold text-[#1a1916] bg-transparent focus:outline-none cursor-pointer pr-1"
            aria-label="Reports year">
            {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            <option value="all">All years</option>
          </select>
        </label>
      </div>

      <DataExports manager={{ rp: effectiveRp }} />

      <h2 className="text-[11px] uppercase tracking-wide font-semibold text-[#9b9890] mb-3">All reports</h2>
      <div className="relative max-w-sm mb-6">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
        <input
          type="text"
          placeholder="Search reports…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm focus:outline-none focus:border-[#2e9f82]"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9b9890] hover:text-[#1a1916]">
            <X size={12} />
          </button>
        )}
      </div>

      {sections.length === 0 ? (
        <div className="text-center py-16">
          <BarChart2 size={32} className="mx-auto text-[#c8c6c0] mb-3" />
          <p className="text-sm text-[#6b6860]">No reports match your search.</p>
        </div>
      ) : (
        sections.map(g => (
          <section key={g.key} className="mb-9">
            <div className="flex items-baseline gap-2.5 mb-1">
              <span className="w-6 h-6 rounded-lg bg-[#f0faf6] flex items-center justify-center self-center">
                <g.Icon size={13} className="text-[#2e9f82]" />
              </span>
              <h2 className="text-sm font-bold text-[#1a1916]">{g.title}</h2>
              <span className="text-xs text-[#9b9890]">{g.blurb}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
              {g.tiles.map(r => r.available ? (
                <button
                  key={r.slug}
                  type="button"
                  onClick={() => navigate(r.slug)}
                  className="group bg-white rounded-2xl border border-[#e8e6e0] p-5 shadow-sm hover:border-[#2e9f82] hover:shadow-md transition-all text-left">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#f0faf6] flex items-center justify-center shrink-0 group-hover:bg-[#2e9f82] transition-colors">
                      <r.Icon size={18} className="text-[#2e9f82] group-hover:text-white transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-[#1a1916] leading-tight">{r.title}</h3>
                      <p className="text-xs text-[#6b6860] mt-1 line-clamp-2">{r.description}</p>
                    </div>
                  </div>
                </button>
              ) : (
                <div key={r.slug} className="bg-white rounded-2xl border border-dashed border-[#e8e6e0] p-5 opacity-70">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#f4f3ef] flex items-center justify-center shrink-0">
                      <r.Icon size={18} className="text-[#9b9890]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-[#6b6860] leading-tight flex items-center gap-2">
                        {r.title}
                        <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-[#f4f3ef] text-[#9b9890] border border-[#e8e6e0]">Soon</span>
                      </h3>
                      <p className="text-xs text-[#9b9890] mt-1 line-clamp-2">{r.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
