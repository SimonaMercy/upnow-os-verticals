'use client';

import { useState } from 'react';
import { Search, X, Download, FileText, BarChart2 } from 'lucide-react';

type ReportMode = 'monthly' | 'yearly';

const REPORT_LIST = [
  'Occupancy Report',
  'Receivables Summary',
  'Collection Rate Report',
  'Security Deposits Report',
  'Lease Expiry Report',
  'Renewal Pipeline Report',
  'Vacancy Analysis',
  'Tenant Ledger',
  'AMC & Vendor Spend',
  'Income Statement',
  'Portfolio Overview',
  'Manager Performance Report',
];

function getCardSummary(name: string, period: string): string {
  return `No data available for ${name} in ${period}`;
}

export default function ReportsPage() {
  const [mode, setMode] = useState<ReportMode>('monthly');
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [yearPeriod, setYearPeriod] = useState(String(new Date().getFullYear()));
  const [search, setSearch] = useState('');
  const [generating, setGenerating] = useState<string | null>(null);

  const currentPeriod = mode === 'monthly' ? period : yearPeriod;

  const periodLabel = mode === 'yearly'
    ? currentPeriod
    : (() => {
        const [y, m] = currentPeriod.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[parseInt(m, 10) - 1] ?? 'Jan'} ${y}`;
      })();

  const filteredReports = REPORT_LIST.filter(r => r.toLowerCase().includes(search.toLowerCase()));

  const handleGenerate = async (name: string) => {
    setGenerating(name);
    await new Promise(r => setTimeout(r, 800));
    setGenerating(null);
    // Toast / download would go here when backend is ready
    alert(`Report generation coming in Sprint 5 (${name})`);
  };

  const years = ['2023', '2024', '2025', '2026', '2027'];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Reports</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Generate and download portfolio reports.</p>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Sprint 5</span> — Live report data coming soon
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        {/* Mode toggle */}
        <div className="flex gap-2">
          {(['monthly', 'yearly'] as ReportMode[]).map(m => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                if (m === 'yearly') setYearPeriod(String(new Date().getFullYear()));
              }}
              className={`px-4 py-2 rounded-full text-sm font-medium capitalize cursor-pointer transition-colors ${mode === m ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#3d3b35]'}`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Period selector */}
        {mode === 'monthly' ? (
          <input
            type="month"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm"
          />
        ) : (
          <select value={yearPeriod} onChange={e => setYearPeriod(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
        <input
          type="text"
          placeholder="Search reports…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-[#9b9890]">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Report cards grid */}
      {filteredReports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart2 size={32} className="text-[#c9c7c1] mb-3" />
          <p className="text-sm text-[#6b6860]">No reports match your search</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredReports.map((r, i) => (
            <div key={i} className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <FileText size={16} className="text-[#2e9f82] shrink-0" />
                <h3 className="font-semibold text-base text-[#1a1916] leading-tight">{r}</h3>
              </div>
              <p className="text-sm text-[#6b6860] mt-1 mb-4 line-clamp-2">
                {getCardSummary(r, periodLabel)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleGenerate(r)}
                  disabled={generating === r}
                  className="text-xs text-white rounded-lg px-3 py-1.5 font-medium cursor-pointer disabled:opacity-50 transition-colors"
                  style={{ background: generating === r ? '#9b9890' : '#2e9f82' }}
                >
                  {generating === r ? 'Generating…' : 'Generate'}
                </button>
                <button className="text-xs text-[#2e9f82] border border-[#2e9f82] rounded-lg px-3 py-1.5 font-medium cursor-pointer flex items-center gap-1">
                  <Download size={11} /> PDF
                </button>
                <button className="text-xs text-[#6b6860] border border-[#e8e6e0] rounded-lg px-3 py-1.5 cursor-pointer flex items-center gap-1">
                  <Download size={11} /> CSV
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
