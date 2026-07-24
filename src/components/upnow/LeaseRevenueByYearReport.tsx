/**
 * Lease Revenue by Year — allocates each lease's rent to the calendar years its
 * TERM covers (period-driven, never the signing date). Two sections mirror the
 * classic spreadsheet:
 *   • Leases       — one row per lease, a column per auto-detected year, total.
 *   • Summary by Year — active-lease count + allocated rent per year + grand total.
 * Plus a rent-by-year bar chart, renewal chains grouped together, and a 90-day
 * expiry flag for chasing renewals. All money is in fils; the view converts.
 *
 * Data: GET {endpointBase}/lease-revenue-by-year (+ any extraQuery like rp=N,
 * + status). Backend returns { years, leases, summaryByYear, chains, totals,
 * invalidRows }. See ReportsService.getLeaseRevenueByYearReport.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Printer, Loader2, AlertCircle, Download, TrendingUp,
  CalendarClock, RefreshCw, Coins,
} from 'lucide-react';

/* ── payload types (subset of ReportsService.LeaseRevenueByYearReport) ─────── */
interface LeaseRow {
  contractId: number;
  contractRef: string;
  tenantName: string | null;
  unitLabel: string | null;
  buildingName: string | null;
  startDate: string | null;
  endDate: string | null;
  monthlyRentFils: number;
  annualRentFils: number;
  totalLeaseValueFils: number;
  allocations: Record<string, number>;
  months: Record<string, number>;
  status: string;
  daysUntilExpiry: number | null;
  expiringSoon: boolean;
  partialBoundary: boolean;
  parentContractId: number | null;
  isRenewal: boolean;
  chainRootId: number;
  chainLength: number;
}
interface YearSummary { year: number; units: number; annualRentFils: number }
interface Chain {
  chainRootId: number; tenantName: string | null; unitLabel: string | null;
  buildingName: string | null; leaseCount: number; contractIds: number[];
  totalValueFils: number; firstStart: string | null; lastEnd: string | null;
}
interface Payload {
  generatedAt: string;
  years: number[];
  leases: LeaseRow[];
  summaryByYear: YearSummary[];
  chains: Chain[];
  totals: {
    leases: number; totalValueFils: number;
    expiringSoon: number; renewals: number; chains: number; marketPriceFils: number; annualRentFils: number;
    totalUnits: number; leasedUnits: number;
  };
  invalidRows: { contractId: number; contractRef: string; reason: string }[];
}

/* ── formatting helpers ────────────────────────────────────────────────────── */
const fmtAed = (fils: number | null | undefined): string => {
  const n = Number(fils ?? 0);
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n / 100);
};
const fmtNum = (fils: number | null | undefined): string =>
  new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Number(fils ?? 0) / 100);
const fmtDate = (s: string | null): string =>
  s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const toCsvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function LeaseRevenueByYearReport({
  endpointBase = '/api/reports',
  extraQuery,
  backHref,
  onBack,
  contractsBase = '/rental-provider/dashboard/contracts',
}: {
  endpointBase?: string;
  extraQuery?: string;
  backHref?: string;
  onBack?: () => void;
  contractsBase?: string;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    // Active leases only.
    const q = new URLSearchParams(extraQuery);
    q.set('status', 'active');
    fetch(`${endpointBase}/lease-revenue-by-year?${q.toString()}`, { credentials: 'include' })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
        return res.json() as Promise<Payload>;
      })
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [endpointBase, extraQuery]);

  const downloadCsv = () => {
    if (!data) return;
    const lines: string[] = [];
    lines.push(['Customer', 'Unit', 'Building', 'Start', 'End', 'Annual Rent (AED)', 'Renewal'].map(toCsvCell).join(','));
    for (const l of data.leases) {
      lines.push([
        l.tenantName, l.unitLabel, l.buildingName, l.startDate, l.endDate,
        fmtNum(l.annualRentFils), l.isRenewal ? 'Renewal' : 'New',
      ].map(toCsvCell).join(','));
    }
    lines.push('');
    lines.push(['Summary by Year (lease started)', 'Units', 'Annual Rent (AED)'].map(toCsvCell).join(','));
    for (const s of data.summaryByYear) lines.push([s.year, s.units, fmtNum(s.annualRentFils)].map(toCsvCell).join(','));
    lines.push(['Total', data.totals.leasedUnits, fmtNum(data.totals.annualRentFils)].map(toCsvCell).join(','));
    const csv = lines.join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'lease-revenue-by-year.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const back = backHref ?? '/rental-provider/dashboard/reports';

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 print:py-0">
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5 print:mb-3">
        <div>
          {onBack ? (
            <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#2e9f82] mb-2 print:hidden">
              <ArrowLeft size={14} /> All Reports
            </button>
          ) : (
            <Link href={back} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#2e9f82] mb-2 print:hidden">
              <ArrowLeft size={14} /> All Reports
            </Link>
          )}
          <h1 className="text-2xl font-bold text-[#26241f] flex items-center gap-2">
            <TrendingUp size={22} className="text-[#2e9f82]" /> Lease Revenue by Year
          </h1>
          <p className="text-sm text-[#6b6860] mt-1 max-w-2xl">
            Each lease&rsquo;s rent split across the calendar years its term actually covers — driven by the
            lease period, not the signing date. Whole calendar months only; a month-aligned annual lease
            allocates its full rent.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={downloadCsv} disabled={!data} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm font-medium text-[#3d3b35] hover:border-[#2e9f82] disabled:opacity-50">
            <Download size={15} /> CSV
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#1a7a5a]">
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {loading && <div className="flex items-center gap-2 text-[#6b6860] py-20 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>}
      {error && !loading && <div className="flex items-center gap-2 text-red-700 py-16 justify-center"><AlertCircle size={16} /> {error}</div>}

      {data && !loading && (
        <>
          {/* ── KPI tiles ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <Kpi label="Active leases" value={String(data.totals.leases)} sub={`${data.years[0] ?? '—'}–${data.years[data.years.length - 1] ?? '—'}`} Icon={CalendarClock} />
            <Kpi label="Annual Rent" value={fmtAed(data.totals.annualRentFils)} sub="contracted · latest lease / unit" Icon={TrendingUp} />
            <Kpi label="Market Price" value={fmtAed(data.totals.marketPriceFils)} sub="asking rent · all units" Icon={Coins} />
          </div>

          {/* ── Summary by Year (per-unit annual rent snapshot) ──────────────── */}
          <Section title="Summary by Year" subtitle="Each unit's current (latest) lease, bucketed by the year it commenced. Every leased unit falls in exactly one year, so Units and Annual Rent sum to your portfolio totals — the grand total Annual Rent matches the KPI above and the Portfolio page.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[#6b6860] border-b border-[#e8e6e0]">
                    <th className="py-2.5 pr-4 font-medium">Lease started</th>
                    <th className="py-2.5 px-4 font-medium text-right">Units</th>
                    <th className="py-2.5 pl-4 font-medium text-right">Annual Rent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summaryByYear.map(s => (
                    <tr key={s.year} className="border-b border-[#f1efe9]">
                      <td className="py-2.5 pr-4 font-medium text-[#26241f]">{s.year}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-[#3d3b35]">{s.units}</td>
                      <td className="py-2.5 pl-4 text-right tabular-nums text-[#26241f]">{fmtAed(s.annualRentFils)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-[#26241f] bg-[#f7f6f2]">
                    <td className="py-2.5 pr-4">Total</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{data.totals.leasedUnits}</td>
                    <td className="py-2.5 pl-4 text-right tabular-nums">{fmtAed(data.totals.annualRentFils)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[#8a8780] mt-3">{data.totals.leasedUnits} of {data.totals.totalUnits} units are leased ({data.totals.totalUnits - data.totals.leasedUnits} never leased). Market Price counts all {data.totals.totalUnits}.</p>
          </Section>

          {/* ── Leases (active leases with their annual rent) ────────────────── */}
          <Section title="Leases" subtitle="Active leases — click a row to open the contract.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-left text-[#6b6860] border-b border-[#e8e6e0]">
                    <th className="py-2.5 pr-4 font-medium">Customer</th>
                    <th className="py-2.5 px-3 font-medium">Unit</th>
                    <th className="py-2.5 px-3 font-medium">Term</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Annual Rent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leases.map(l => (
                    <tr key={l.contractId} className="border-b border-[#f1efe9] hover:bg-[#f7f6f2] group">
                      <td className="py-2.5 pr-4">
                        <Link href={`${contractsBase}/${l.contractId}`} className="font-medium text-[#26241f] group-hover:text-[#2e9f82]">
                          {l.tenantName ?? l.contractRef}
                        </Link>
                        {l.isRenewal && <div className="mt-0.5"><Badge tone="info"><RefreshCw size={10} /> Renewal</Badge></div>}
                      </td>
                      <td className="py-2.5 px-3 text-[#3d3b35]">
                        {l.unitLabel ?? '—'}
                        {l.buildingName && <div className="text-xs text-[#8a8780]">{l.buildingName}</div>}
                      </td>
                      <td className="py-2.5 px-3 text-[#6b6860] text-xs">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                      <td className="py-2.5 pl-3 text-right tabular-nums font-semibold text-[#26241f]">{fmtNum(l.annualRentFils)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[#8a8780] mt-3">All amounts in AED. Rent is net (VAT is carried separately on the cheques).</p>
          </Section>
        </>
      )}
    </div>
  );
}

/* ── small presentational helpers ──────────────────────────────────────────── */
function Kpi({ label, value, sub, Icon, tone }: { label: string; value: string; sub?: string; Icon: React.ComponentType<{ size?: number; className?: string }>; tone?: 'warn' }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-[#e8e6e0] bg-white'}`}>
      <div className="flex items-center gap-1.5 text-xs text-[#6b6860]"><Icon size={13} /> {label}</div>
      <div className="text-xl font-bold text-[#26241f] mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[#8a8780] mt-0.5">{sub}</div>}
    </div>
  );
}
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4 sm:p-5 mb-6">
      <div className="mb-3">
        <div className="text-base font-semibold text-[#26241f]">{title}</div>
        {subtitle && <div className="text-xs text-[#8a8780] mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
function Badge({ tone, children, title }: { tone: 'info' | 'warn' | 'muted'; children: React.ReactNode; title?: string }) {
  const cls = tone === 'warn' ? 'bg-amber-100 text-amber-800'
    : tone === 'info' ? 'bg-[#e6f4ef] text-[#1a7a5a]'
    : 'bg-[#f4f3ef] text-[#8a8780]';
  return <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium ${cls}`}>{children}</span>;
}
