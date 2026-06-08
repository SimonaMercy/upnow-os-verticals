/**
 * RP Contracts list — minimal table of every contract under this RP.
 *
 * Route: /rental-provider/dashboard/contracts
 *
 * The detail page's back arrow lands here. Also the destination of the dashboard's
 * "All contracts" link. Lists every contract from GET /api/contracts.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, Loader2, Search, Plus } from 'lucide-react';

interface RpContract {
  id: number;
  ref: string;
  contractType: string;
  startDate: string | null;
  endDate: string | null;
  annualRent: number;
  status: string;
  ejariStatus: string | null;
  contractActive: boolean;
  renewalStatus: string | null;
  createdAt: string;
  tenant: { id: number | null; name: string | null; email: string | null };
  unit: { id: number | null; number: string | null; name: string | null };
  property?: { id?: number | null; buildingName?: string | null };
}

const STATUS_PILL: Record<string, { bg: string; text: string; label: string }> = {
  active:     { bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', label: 'Active' },
  issued:     { bg: 'bg-[#fef3c7]', text: 'text-[#854d0e]', label: 'Issued' },
  pending:    { bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', label: 'Pending' },
  terminated: { bg: 'bg-[#fee2e2]', text: 'text-[#b91c1c]', label: 'Terminated' },
  expired:    { bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', label: 'Expired' },
};

function fmtAed(v: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(v);
}
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ContractsListPage() {
  const [contracts, setContracts] = useState<RpContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/contracts', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then((data: RpContract[]) => setContracts(Array.isArray(data) ? data : []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return contracts;
    return contracts.filter(c => {
      const blob = [
        c.ref, c.tenant.name, c.tenant.email,
        c.unit.name, c.unit.number,
        c.property?.buildingName, c.status, c.contractType,
      ].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(needle);
    });
  }, [contracts, q]);

  return (
    <div className="min-h-screen bg-[#f7f6f2]">
      <div className="bg-white border-b border-[#e8e6e0] px-4 sm:px-6 py-4 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/rental-provider/dashboard" className="text-[#6b6860] hover:text-[#1a1916]" title="Back to dashboard">
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#1a1916]">All Contracts</p>
              <p className="text-[11px] text-[#9b9890] mt-0.5">{loading ? 'Loading…' : `${filtered.length} contract${filtered.length === 1 ? '' : 's'}`}</p>
            </div>
          </div>
          <Link
            href="/rental-provider/dashboard/contracts/new"
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl text-white"
            style={{ background: '#2e9f82' }}
          >
            <Plus size={14} /> New Contract
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by reference, customer, unit, building…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[#e8e6e0] bg-white text-sm focus:outline-none focus:border-[#2e9f82]"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-[#2e9f82]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
            <FileText size={24} className="mx-auto text-[#c8c6c0] mb-3" />
            <p className="text-sm font-semibold text-[#1a1916]">No contracts found</p>
            <p className="text-xs text-[#9b9890] mt-1">{q ? 'Try a different search term.' : 'Create your first contract to get started.'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Contract</th>
                    <th className="px-4 py-3 text-left font-semibold">Customer</th>
                    <th className="px-4 py-3 text-left font-semibold">Unit</th>
                    <th className="px-4 py-3 text-left font-semibold">Period</th>
                    <th className="px-4 py-3 text-right font-semibold">Annual Rent</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const status = STATUS_PILL[c.status] ?? { bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', label: c.status };
                    return (
                      <tr key={c.id} className="border-t border-[#f0ede8] hover:bg-[#fafaf8] transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/rental-provider/dashboard/contracts/${c.id}/v2`} className="font-semibold text-[#1a1916] hover:text-[#2e9f82]">
                            {c.ref}
                          </Link>
                          {c.contractType === 'renewal' && (
                            <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[#fef3c7] text-[#854d0e]">RENEWAL</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[#1a1916] truncate">{c.tenant.name ?? '—'}</p>
                          {c.tenant.email && <p className="text-[11px] text-[#9b9890] truncate">{c.tenant.email}</p>}
                        </td>
                        <td className="px-4 py-3 text-[#6b6860]">
                          <p className="truncate">{c.unit.name ?? (c.unit.number ? `Unit ${c.unit.number}` : '—')}</p>
                          {c.property?.buildingName && <p className="text-[11px] text-[#9b9890] truncate">{c.property.buildingName}</p>}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-[#6b6860]">
                          {fmtDate(c.startDate)}<br />→ {fmtDate(c.endDate)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-[#1a1916]">{fmtAed(c.annualRent)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${status.bg} ${status.text}`}>{status.label}</span>
                          {c.renewalStatus && (
                            <div className="mt-1 inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[#fef3c7] text-[#854d0e]">↻ Renewal {c.renewalStatus}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
