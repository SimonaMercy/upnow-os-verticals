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
} from 'lucide-react';

interface ReportTile {
  slug: string;
  title: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  available: boolean;
}

const REPORTS: ReportTile[] = [
  { slug: 'occupancy',          title: 'Occupancy Report',         description: 'Units, occupied counts, and contracted rent per property.',           Icon: Building2,    available: true  },
  { slug: 'receivables',        title: 'Receivables Summary',      description: 'Outstanding cheques aged 0-30 / 31-60 / 61-90 / 90+.',                Icon: Wallet,       available: true  },
  { slug: 'lease-expiry',       title: 'Lease Expiry Report',      description: 'Active contracts ending within 30 / 60 / 90 / 180 / 365 days.',       Icon: CalendarClock, available: true },
  { slug: 'renewal-forecast',   title: 'Renewal Forecast',         description: 'Leases coming up for renewal each month, with annual rent at stake.',  Icon: RefreshCw,    available: true  },
  { slug: 'rent-collection',    title: 'Rent Collection (Rent Roll)', description: 'Collection matrix — customers down, months across, totals.',          Icon: BarChart2,    available: true  },
  { slug: 'cheque-register',    title: 'PDC / Cheque Register',    description: 'Every cheque with its status — pending, cleared, bounced, cancelled.', Icon: ScrollText,   available: true  },
  { slug: 'collection-rate',    title: 'Collection Rate Report',   description: 'Monthly collected vs scheduled rent, with collection %.',              Icon: BarChart2,    available: true  },
  { slug: 'security-deposits',  title: 'Security Deposits Report', description: 'Deposit register with lifecycle — held, returned, forfeited.',         Icon: ShieldCheck,  available: true  },
  { slug: 'vacancy-analysis',   title: 'Vacancy Analysis',         description: 'Vacant units, asking rent at stake, and listing status.',              Icon: MapPin,       available: true  },
  { slug: 'leasing-activity',   title: 'Leasing Activity',         description: 'New leases per month, rent signed, and Ejari status.',                 Icon: CalendarClock, available: true },
  { slug: 'tenant-ledger',      title: 'Customer Ledger',          description: 'Per-customer rent collected, outstanding, and last payment.',          Icon: FileText,     available: true  },
  { slug: 'portfolio-overview', title: 'Portfolio Overview',       description: 'Units by type, occupancy, and annual asking rent.',                    Icon: FileBarChart, available: true  },
  { slug: 'income-statement',   title: 'Income Statement',         description: 'Revenue by stream — rent, admin, ejari, deposits.',                    Icon: BarChart2,    available: false },
  { slug: 'amc-vendor-spend',   title: 'AMC & Vendor Spend',       description: 'Vendor invoices and AMC contract costs.',                              Icon: Wrench,       available: false },
  { slug: 'manager-performance', title: 'Manager Performance Report', description: 'Per-asset-manager activity and deal velocity.',                     Icon: Users,        available: false },
];

export default function ReportsPage() {
  const [search, setSearch] = useState('');
  const filtered = REPORTS.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase())
    || r.description.toLowerCase().includes(search.toLowerCase()),
  );
  const available = filtered.filter(r => r.available);
  const upcoming = filtered.filter(r => !r.available);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Reports</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Interactive portfolio reports — view inline, download CSV, or print as PDF.</p>
        </div>
      </div>

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

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <BarChart2 size={32} className="mx-auto text-[#c8c6c0] mb-3" />
          <p className="text-sm text-[#6b6860]">No reports match your search.</p>
        </div>
      ) : (
        <>
          {available.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase tracking-wide font-semibold text-[#9b9890] mb-3">Available now</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {available.map(r => (
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
                ))}
              </div>
            </>
          )}

          {upcoming.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase tracking-wide font-semibold text-[#9b9890] mb-3 mt-4 flex items-center gap-1.5">
                <AlertCircle size={11} /> Coming soon — needs additional data tracking
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {upcoming.map(r => (
                  <div key={r.slug} className="bg-white rounded-2xl border border-[#e8e6e0] p-5 opacity-60">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#f4f3ef] flex items-center justify-center shrink-0">
                        <r.Icon size={18} className="text-[#9b9890]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-[#6b6860] leading-tight">{r.title}</h3>
                        <p className="text-xs text-[#9b9890] mt-1 line-clamp-2">{r.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
