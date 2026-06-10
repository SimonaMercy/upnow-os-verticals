'use client';

/**
 * Manager · Deposits page
 *
 * Mirrors the landlord Deposits page design EXACTLY
 * (src/app/rental-provider/dashboard/deposits/page.tsx) but:
 *   - Fetches the selected landlord's data via GET /manager/deposits?rp=<id>.
 *     That endpoint calls the same contractsService.listDeposits() the RP
 *     route uses, so the response shape is identical and the RP page's
 *     `Deposit` type + rendering are reused verbatim.
 *   - Is permission-gated per landlord on `canManageDeposits`, with a lock
 *     screen when the selected landlord hasn't delegated that permission
 *     (mirrors the manager Contracts page gate).
 *   - Is READ-ONLY: managers can't reach /rental-provider/* routes, so the
 *     contract-ref link and "Open Contract" action are rendered as plain
 *     text. All display / filter / search / detail UI is preserved.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, X, Wallet, Loader2, RefreshCw, Lock, ExternalLink, FileText } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

type DepositStatus = 'held' | 'returned' | 'partial_deduction' | 'forfeited';

const STATUS_LABELS: Record<DepositStatus, string> = {
  held:               'Held',
  returned:           'Returned',
  partial_deduction:  'Partial Deduction',
  forfeited:          'Forfeited',
};

const STATUS_STYLE: Record<DepositStatus, string> = {
  held:               'bg-[#d8f2e8] text-[#1a7a5a]',
  returned:           'bg-[#dbeafe] text-[#1e40af]',
  partial_deduction:  'bg-[#fef3c7] text-[#92400e]',
  forfeited:          'bg-[#fee2e2] text-[#b91c1c]',
};

interface Deposit {
  id: string;
  depositRef: string;
  contractRef: string;
  contractId: number | null;
  tenant: string;
  building: string;
  unit: string;
  amount: number;
  amountReceipt: number | null;
  recordedDate: string | null;
  status: DepositStatus;
  fromYear: number | null;
  toYear: number | null;
  notes: string | null;
  proofs?: DepositProof[];
}

interface DepositProof {
  documentKey: string;
  displayName: string | null;
  mimeType: string | null;
  fileUrl: string | null;
}

function fmtAed(v: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(v);
}

/** Human label for a deposit proof, derived from its document_key. */
function proofLabel(key: string): string {
  if (key.startsWith('deposit_cheque')) return 'Cheque';
  if (key.startsWith('deposit_slip') || key.startsWith('bank')) return 'Bank Transfer';
  if (key.startsWith('deposit_receipt')) return 'Receipt';
  return key.replace(/_/g, ' ');
}

export default function ManagerDepositsPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  // Effective landlord = the one chosen in the LandlordSwitcher, else the first
  // managed landlord that delegated deposit access.
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageDeposits)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageDeposits', effectiveRp);

  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load() {
    if (effectiveRp == null || !allowed) { setDeposits([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const data = await apiGet<Deposit[]>(`/manager/deposits?rp=${effectiveRp}`);
      setDeposits(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load deposits.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [effectiveRp, allowed]);

  // Per-landlord permission gate — mirrors the lock the nav enforces.
  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            This landlord hasn’t granted you the <strong>Manage Deposits</strong> permission, so their security deposits aren’t available.
          </p>
        </div>
      </div>
    );
  }

  const buildings = [...new Set(deposits.map(d => d.building).filter(b => b !== '—'))];

  const filtered = deposits.filter(d => {
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (filterBuilding !== 'all' && d.building !== filterBuilding) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !d.depositRef.toLowerCase().includes(q) &&
        !d.tenant.toLowerCase().includes(q) &&
        !d.unit.toLowerCase().includes(q) &&
        !d.contractRef.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const hasFilters = filterStatus !== 'all' || filterBuilding !== 'all' || search !== '';
  const clearFilters = () => { setFilterStatus('all'); setFilterBuilding('all'); setSearch(''); };

  // Summary stats
  const totalHeld      = deposits.filter(d => d.status === 'held').reduce((s, d) => s + d.amount, 0);
  const heldCount      = deposits.filter(d => d.status === 'held').length;
  const returnedCount  = deposits.filter(d => d.status === 'returned').length;
  const dedCount       = deposits.filter(d => d.status === 'partial_deduction').length;
  const totalAmount    = deposits.reduce((s, d) => s + d.amount, 0);

  const detail = detailId !== null ? deposits.find(d => d.id === detailId) ?? null : null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Security Deposits</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Track all security deposits across the landlord’s rental agreements.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] transition-colors disabled:opacity-50 cursor-pointer">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total Records',       value: String(deposits.length),     sub: 'all deposits' },
          { label: 'Total Amount',        value: fmtAed(totalAmount),         sub: 'recorded' },
          { label: 'Currently Held',      value: fmtAed(totalHeld),           sub: `${heldCount} active` },
          { label: 'Returned',            value: String(returnedCount),       sub: 'completed' },
          { label: 'With Deductions',     value: String(dedCount),            sub: 'partial returns' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm border border-[#f0ede8]">
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            <div className="font-bold text-xl text-[#1a1916] mt-1 truncate">{s.value}</div>
            <div className="text-xs text-[#9b9890] mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 flex flex-wrap gap-3 items-center mb-4 shadow-sm border border-[#f0ede8]">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input type="text" placeholder="Search ref, customer, unit…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
          <option value="all">All Statuses</option>
          {(Object.keys(STATUS_LABELS) as DepositStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        {buildings.length > 0 && (
          <select value={filterBuilding} onChange={e => setFilterBuilding(e.target.value)}
            className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35] cursor-pointer">
            <option value="all">All Buildings</option>
            {buildings.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        {hasFilters && (
          <button onClick={clearFilters}
            className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">{filtered.length} deposit{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#f0ede8]">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-[#2e9f82]" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={load} className="text-xs text-[#2e9f82] font-medium hover:underline cursor-pointer">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
              <Wallet size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">
              {hasFilters ? 'No deposits match your filters.' : 'No security deposits recorded yet.'}
            </p>
            <p className="text-xs text-[#9b9890]">Deposits are recorded from the contract detail page.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[900px]">
              <thead>
                <tr className="bg-[#f4f3ef] border-b border-[#e8e6e0]">
                  {['Deposit Ref', 'Contract', 'Building', 'Unit', 'Customer', 'Amount', 'Status'].map(h => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id} onClick={() => setDetailId(d.id)}
                    className="border-b border-[#f0ede8] hover:bg-[#fafaf8] text-sm text-[#1a1916] cursor-pointer transition-colors">
                    <td className="px-4 py-3.5 font-medium font-mono text-xs">{d.depositRef}</td>
                    <td className="px-4 py-3.5">
                      {d.contractRef ? (
                        <span className="text-[#3d3b35] font-medium">{d.contractRef}</span>
                      ) : <span className="text-[#9b9890]">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{d.building}</td>
                    <td className="px-4 py-3.5">{d.unit}</td>
                    <td className="px-4 py-3.5">{d.tenant}</td>
                    <td className="px-4 py-3.5 font-semibold">{fmtAed(d.amount)}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${STATUS_STYLE[d.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                        {STATUS_LABELS[d.status] ?? d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetailId(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0]">
              <div>
                <p className="font-bold text-[#1a1916]">Deposit Detail</p>
                <p className="text-xs text-[#9b9890] font-mono mt-0.5">{detail.depositRef}</p>
              </div>
              <button onClick={() => setDetailId(null)} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer p-1">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 flex-1 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full text-xs font-semibold px-3 py-1 ${STATUS_STYLE[detail.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                  {STATUS_LABELS[detail.status] ?? detail.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Contract',    value: detail.contractRef },
                  { label: 'Building',    value: detail.building },
                  { label: 'Unit',        value: detail.unit },
                  { label: 'Customer',    value: detail.tenant },
                  { label: 'Cheque Amount', value: fmtAed(detail.amount) },
                  { label: 'Receipt Amount', value: detail.amountReceipt != null ? fmtAed(detail.amountReceipt) : '—' },
                ].map(item => (
                  <div key={item.label} className="bg-[#f4f3ef] rounded-xl p-3">
                    <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1">{item.label}</p>
                    <p className="text-sm font-semibold text-[#1a1916]">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Payment proof — the cheque image or bank-transfer slip/receipt */}
              <div>
                <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-2">Payment proof</p>
                {(detail.proofs?.length ?? 0) === 0 ? (
                  <div className="bg-[#fffbeb] border border-[#fde68a] rounded-xl p-3">
                    <p className="text-xs text-[#92400e]">No cheque image or bank-transfer proof uploaded for this deposit.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {detail.proofs!.map((pf, i) => {
                      const isImg = (pf.mimeType ?? '').startsWith('image/');
                      return (
                        <a key={i} href={pf.fileUrl ?? '#'} target="_blank" rel="noreferrer"
                          className="block rounded-xl border border-[#e8e6e0] overflow-hidden hover:border-[#2e9f82] transition-colors">
                          {isImg && pf.fileUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={pf.fileUrl} alt={proofLabel(pf.documentKey)} className="w-full h-28 object-cover bg-[#f4f3ef]" />
                          ) : (
                            <div className="w-full h-28 flex items-center justify-center bg-[#f4f3ef] text-[#9b9890]">
                              <FileText size={28} />
                            </div>
                          )}
                          <div className="px-2.5 py-2">
                            <p className="text-xs font-semibold text-[#1a1916]">{proofLabel(pf.documentKey)}</p>
                            <p className="text-[10px] text-[#2e9f82] flex items-center gap-1"><ExternalLink size={10} /> View</p>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
              {detail.notes && (
                <div className="bg-[#f4f3ef] rounded-xl p-3">
                  <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-[#3d3b35]">{detail.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
