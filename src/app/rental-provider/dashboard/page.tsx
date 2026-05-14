/**
 * Rental Provider — Overview Dashboard (rental-provider/dashboard)
 *
 * Top-level RP dashboard. Shows KPI cards (properties, units, active contracts,
 * leads, receivables), quick-action buttons, and recent activity feed.
 *
 * Data sources: /properties/my, /contracts/rp, /leads/rp/all,
 *   /contracts/rp/financial-summary.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Building2, DollarSign, Users, FileText, RefreshCw, AlertCircle, Calendar, PlusSquare, LayoutList, ClipboardList, Wrench, CreditCard, BarChart3 } from 'lucide-react';
import Link from 'next/link';

interface DashboardStats {
  totalProperties: number;
  totalUnits: number;
  occupied: number;
  available: number;
  maintenance: number;
  reserved: number;
  occupancyRate: number;
  activeContracts: number;
  renewalsDue60Days: number;
}

interface FinancialSummary {
  receivablesInRange: number;
  overdueOrBounced: number;
  depositsHeld: number;
  rangeStart: string;
  rangeEnd: string;
  chartData: Array<{ m: string; receivable: number; collected: number }>;
}

function fmtAed(n: number) {
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `AED ${(n / 1_000).toFixed(0)}K`;
  return `AED ${n.toLocaleString()}`;
}

type RangePreset = 'this_month' | 'last_month' | 'last_3m' | 'last_6m' | 'this_year' | 'all_time';

const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_3m',    label: 'Last 3M' },
  { key: 'last_6m',    label: 'Last 6M' },
  { key: 'this_year',  label: 'This Year' },
  { key: 'all_time',   label: 'All Time' },
];

function presetToDates(preset: RangePreset): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = fmt(now);
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case 'this_month':
      return { from: fmt(new Date(y, m, 1)), to: today };
    case 'last_month': {
      const start = new Date(y, m - 1, 1);
      const end   = new Date(y, m, 0);
      return { from: fmt(start), to: fmt(end) };
    }
    case 'last_3m':
      return { from: fmt(new Date(y, m - 2, 1)), to: today };
    case 'last_6m':
      return { from: fmt(new Date(y, m - 5, 1)), to: today };
    case 'this_year':
      return { from: `${y}-01-01`, to: today };
    case 'all_time':
      return { from: '2020-01-01', to: today };
  }
}

const QUICK_LINKS = [
  { label: 'List Property',  href: '/rental-provider/dashboard/portfolio?action=add', Icon: PlusSquare },
  { label: 'New Contract',   href: '/rental-provider/dashboard/contracts/new',        Icon: ClipboardList },
  { label: 'Leads',          href: '/rental-provider/dashboard/leads',                Icon: AlertCircle },
  { label: 'Tenants',        href: '/rental-provider/dashboard/tenants',              Icon: Users },
  { label: 'Receivables',    href: '/rental-provider/dashboard/receivables',          Icon: CreditCard },
  { label: 'Deposits',       href: '/rental-provider/dashboard/deposits',             Icon: DollarSign },
  { label: 'Reports',        href: '/rental-provider/dashboard/reports',              Icon: BarChart3 },
];

export default function RentalProviderDashboard() {
  const { user } = useAuth();
  const name = user?.name ?? user?.firstName ?? 'there';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [fin, setFin] = useState<FinancialSummary | null>(null);
  const [selectedRange, setSelectedRange] = useState<RangePreset>('this_month');
  const [finLoading, setFinLoading] = useState(false);

  // Fetch portfolio stats whenever range changes
  useEffect(() => {
    const { from, to } = presetToDates(selectedRange);
    fetch(`/api/properties/dashboard-stats?from=${from}&to=${to}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data && typeof data.totalUnits === 'number') setStats(data); })
      .catch(() => undefined);
  }, [selectedRange]);

  // Fetch financial summary whenever range changes
  const fetchFinancial = useCallback((preset: RangePreset) => {
    const { from, to } = presetToDates(preset);
    setFinLoading(true);
    fetch(`/api/contracts/financial-summary?from=${from}&to=${to}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data && typeof data.receivablesInRange === 'number') setFin(data); })
      .catch(() => undefined)
      .finally(() => setFinLoading(false));
  }, []);

  useEffect(() => { fetchFinancial(selectedRange); }, [selectedRange, fetchFinancial]);

  const occupied = stats?.occupied ?? 0;
  const available = stats?.available ?? 0;
  const totalUnits = stats?.totalUnits ?? 0;
  const totalProperties = stats?.totalProperties ?? 0;
  const occupancyRate = stats?.occupancyRate ?? 0;
  const activeContracts = stats?.activeContracts ?? 0;
  const renewalsDue60Days = stats?.renewalsDue60Days ?? 0;

  const OVERVIEW_STATS = [
    { label: 'Total Units',            value: String(totalUnits),                  sub: `across ${totalProperties} assets` },
    { label: 'Occupied',               value: String(occupied),                    sub: `${occupancyRate}% occupancy` },
    { label: 'Available',              value: String(available),                   sub: 'ready to list' },
    { label: 'Active Orders',          value: String(activeContracts),             sub: 'rental agreements' },
    { label: 'Renewals Due (60 days)', value: String(renewalsDue60Days),           sub: renewalsDue60Days > 0 ? 'action needed' : 'none pending' },
    { label: `Receivables (${RANGE_PRESETS.find(r => r.key === selectedRange)?.label ?? ''})`,
                                       value: finLoading ? '…' : (fin ? fmtAed(fin.receivablesInRange) : '—'), sub: 'payments in period' },
    { label: 'Overdue / Bounced',      value: fin ? String(fin.overdueOrBounced) : '—',      sub: 'pending past due date' },
    { label: 'Deposits Held',          value: fin ? fmtAed(fin.depositsHeld) : '—',          sub: 'active security deposits' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Welcome, {name}</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Here&apos;s your portfolio at a glance.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date range selector */}
          <div className="flex items-center gap-1 bg-white rounded-xl px-1 py-1 shadow-sm border border-[#e8e6e0]">
            <Calendar size={14} className="text-[#6b6860] ml-2 mr-1" />
            {RANGE_PRESETS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSelectedRange(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  selectedRange === key
                    ? 'bg-[#2e9f82] text-white'
                    : 'text-[#6b6860] hover:bg-[#f4f3ef]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Link
            href="/rental-provider/dashboard/portfolio?action=add"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: '#2e9f82' }}
          >
            <Building2 size={16} /> List Property
          </Link>
        </div>
      </div>

      {/* 8-stat grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {OVERVIEW_STATS.map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="w-9 h-9 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-3">
              <DollarSign size={16} className="text-[#2e9f82]" />
            </div>
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            <div className="font-bold text-2xl text-[#1a1916] mt-1">{s.value}</div>
            <div className="text-xs text-[#9b9890] mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Occupancy Gauge */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h3 className="font-semibold text-sm text-[#1a1916] mb-4">Occupancy Rate</h3>
          <div className="flex items-center justify-center">
            <div className="relative w-44 h-44">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#e8e6e0" strokeWidth="12" />
                <circle
                  cx="50" cy="50" r="40" fill="none"
                  stroke="#2e9f82" strokeWidth="12"
                  strokeDasharray={`${(occupancyRate / 100) * 251} 251`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-bold text-3xl text-[#2e9f82]">{occupancyRate}%</span>
                <span className="text-xs text-[#6b6860]">Occupancy Rate</span>
              </div>
            </div>
          </div>
          <div className="flex justify-center gap-6 mt-4 text-xs text-[#6b6860]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#2e9f82]" />
              Occupied {occupied}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#e8e6e0]" />
              Available {available}
            </span>
          </div>
        </div>

        {/* Receivables vs Collected bar chart */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h3 className="font-semibold text-sm text-[#1a1916] mb-4">
            Receivables vs Collected — {RANGE_PRESETS.find(r => r.key === selectedRange)?.label}
          </h3>
          {fin && fin.chartData.length > 0 ? (() => {
            const maxVal = Math.max(...fin.chartData.flatMap(d => [d.receivable, d.collected]), 1);
            const many = fin.chartData.length > 8;
            return (
              <>
                <div className={many ? 'overflow-x-auto' : ''}>
                  <div
                    className="flex items-end gap-2 px-1"
                    style={{
                      height: '160px',
                      minWidth: many ? `${fin.chartData.length * 44}px` : undefined,
                    }}
                  >
                    {fin.chartData.map((d, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1" style={{ minWidth: '36px' }}>
                        <div className="flex gap-0.5 items-end w-full justify-center" style={{ height: '130px' }}>
                          <div
                            className="flex-1 rounded-t-sm bg-[#d8f2e8] max-w-[14px]"
                            style={{ height: `${Math.max(4, (d.receivable / maxVal) * 100)}%` }}
                            title={`Receivable: AED ${d.receivable.toLocaleString()}`}
                          />
                          <div
                            className="flex-1 rounded-t-sm bg-[#2e9f82] max-w-[14px]"
                            style={{ height: `${Math.max(4, (d.collected / maxVal) * 100)}%` }}
                            title={`Collected: AED ${d.collected.toLocaleString()}`}
                          />
                        </div>
                        <span className="text-[9px] text-[#6b6860] text-center leading-tight whitespace-nowrap">{d.m}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-center gap-6 mt-4 text-xs text-[#6b6860]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-[#d8f2e8]" />
                    Receivable
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-[#2e9f82]" />
                    Collected
                  </span>
                </div>
              </>
            );
          })() : (
            <div className="flex items-end gap-3 px-2" style={{ height: '160px' }}>
              {['', '', '', '', '', ''].map((_, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex gap-1 items-end w-full justify-center" style={{ height: '130px' }}>
                    <div className="w-5 rounded-t-sm bg-[#e8e6e0] animate-pulse" style={{ height: '60%' }} />
                    <div className="w-5 rounded-t-sm bg-[#e8e6e0] animate-pulse" style={{ height: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div>
        <h3 className="text-xs font-semibold text-[#9b9890] uppercase tracking-wider mb-3">Quick Access</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {QUICK_LINKS.map(({ label, href, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 bg-white rounded-xl px-4 py-3.5 shadow-sm hover:shadow-md transition-shadow group"
            >
              <div className="w-8 h-8 rounded-lg bg-[#f4f3ef] flex items-center justify-center group-hover:bg-[#d8f2e8] transition-colors">
                <Icon size={15} className="text-[#6b6860] group-hover:text-[#2e9f82] transition-colors" />
              </div>
              <span className="text-sm font-medium text-[#1a1916]">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
