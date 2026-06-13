/**
 * Reports landing page — lists every report card and routes to the slug detail
 * page when available. Reports without backend data yet show as "Coming soon".
 *
 * The four `available: true` reports route to /reports/<slug> which fetches
 * `/api/reports/<slug>` and renders an interactive table + CSV + PDF.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Search, X, FileText, BarChart2, Building2, AlertCircle, CalendarClock,
  RefreshCw, MapPin, Wallet, ShieldCheck, Users, Wrench, FileBarChart, ScrollText,
  Banknote, TrendingUp,
} from 'lucide-react';
import ExecutiveOverview from './ExecutiveOverview';
import { GROUPS, REPORT_TILES } from '@/components/upnow/reportCatalog';

export default function ReportsPage() {
  const [search, setSearch] = useState('');
  const filtered = REPORT_TILES.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase())
    || r.description.toLowerCase().includes(search.toLowerCase()),
  );
  // Grouped sections; a section disappears entirely when the search leaves
  // it with no matching reports.
  const sections = GROUPS
    .map(g => ({ ...g, tiles: filtered.filter(r => r.group === g.key) }))
    .filter(g => g.tiles.length > 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Reports</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Where the portfolio stands right now — then drill into any report below.</p>
        </div>
      </div>

      {/* Executive overview — KPI tiles, exceptions, charts */}
      <ExecutiveOverview />

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
                <Link
                  key={r.slug}
                  href={`/rental-provider/dashboard/reports/${r.slug}`}
                  className="group bg-white rounded-2xl border border-[#e8e6e0] p-5 shadow-sm hover:border-[#2e9f82] hover:shadow-md transition-all">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#f0faf6] flex items-center justify-center shrink-0 group-hover:bg-[#2e9f82] transition-colors">
                      <r.Icon size={18} className="text-[#2e9f82] group-hover:text-white transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-[#1a1916] leading-tight">{r.title}</h3>
                      <p className="text-xs text-[#6b6860] mt-1 line-clamp-2">{r.description}</p>
                    </div>
                  </div>
                </Link>
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
