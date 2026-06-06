/**
 * Manager "Customers / Tenants" page.
 *
 * Mirrors the landlord Customers page design EXACTLY
 * (src/app/rental-provider/dashboard/tenants/page.tsx) but for the landlord
 * selected in the LandlordSwitcher (`?rp=<landlordId>`), permission-gated on
 * `canManageAgreements` and rendered read-only (no /rental-provider links).
 *
 * Like the RP page, the tenant list is DERIVED from the contracts data — here
 * fetched from `/manager/contracts?rp=<id>` (same backend `listForRp` shape the
 * RP page consumes), using the identical dedup/derivation logic copied verbatim.
 */
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, X, Users, Lock } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

type ContractStatus = 'active' | 'terminated' | 'none';

type Tenant = {
  id: number;
  contractId: number | null;
  name: string;
  email: string;
  unit: string;
  asset: string;
  contractStatus: ContractStatus;
  rentPerYear: number;
  renewalDays: number | null;
  endDate: string | null;
};

/** Shape of each row from `/manager/contracts` (backend `listForRp`). */
type ContractRow = {
  id: number | null;
  status: string;
  contractActive: boolean;
  annualRent: number | null;
  endDate: string | null;
  tenant: { id: number | null; name: string | null; email: string | null };
  unit: { number: string | null; name: string | null };
  property: { buildingName: string | null };
};

const CONTRACT_LABELS: Record<ContractStatus, string> = {
  active: 'Active',
  terminated: 'Terminated',
  none: 'No Contract',
};

const CONTRACT_STYLE: Record<ContractStatus, string> = {
  active: 'bg-[#d8f2e8] text-[#1a7a5a]',
  terminated: 'bg-[#fee2e2] text-[#b91c1c]',
  none: 'bg-[#f4f3ef] text-[#6b6860]',
};

function calcRenewalDays(endDate: string | null): number | null {
  if (!endDate) return null;
  // Compare calendar day to calendar day (UTC) so the count isn't skewed by the
  // current time-of-day vs the date's UTC-midnight.
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - todayUtc) / 86400000);
}

export default function ManagerTenantsPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  // Effective landlord = the one chosen in the LandlordSwitcher (`?rp=`), else
  // the first managed landlord that delegated agreement access.
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageAgreements)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageAgreements', effectiveRp);

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterContract, setFilterContract] = useState('all');

  useEffect(() => {
    if (effectiveRp == null || !allowed) { setTenants([]); setLoading(false); return; }
    setLoading(true);
    apiGet<ContractRow[]>(`/manager/contracts?rp=${effectiveRp}`)
      .then(data => {
        if (!Array.isArray(data)) return;
        // Deduplicate by tenant id, keeping the most recent active contract
        // (logic copied verbatim from the RP Customers page).
        const map = new Map<number, Tenant>();
        for (const c of data) {
          const tid = c.tenant?.id;
          if (!tid || !c.tenant?.name) continue;
          const contractStatus: ContractStatus =
            c.contractActive ? 'active' : c.status === 'terminated' ? 'terminated' : 'none';
          const existing = map.get(tid);
          // Prefer active contracts; among equals keep the more recent one,
          // comparing like-for-like end dates (the later-ending contract is the
          // current/renewed one).
          if (!existing || (contractStatus === 'active' && existing.contractStatus !== 'active') ||
              (contractStatus === existing.contractStatus && new Date(c.endDate ?? 0) > new Date(existing.endDate ?? 0))) {
            map.set(tid, {
              id: tid,
              contractId: c.id ?? null,
              name: c.tenant.name,
              email: c.tenant.email ?? '',
              unit: c.unit?.number ? `Unit ${c.unit.number}` : (c.unit?.name ?? '—'),
              asset: c.property?.buildingName ?? '—',
              contractStatus,
              rentPerYear: c.annualRent ?? 0,
              endDate: c.endDate ?? null,
              renewalDays: calcRenewalDays(c.endDate),
            });
          }
        }
        setTenants(Array.from(map.values()));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [effectiveRp, allowed]);

  // Per-landlord permission gate — mirrors the lock the manager contracts page uses.
  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            This landlord hasn’t granted you the <strong>Manage Agreements</strong> permission, so their customers aren’t available.
          </p>
        </div>
      </div>
    );
  }

  const filtered = tenants.filter(t => {
    if (filterContract !== 'all' && t.contractStatus !== filterContract) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !t.email.toLowerCase().includes(q) && !t.unit.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilters = filterContract !== 'all' || search !== '';
  const clearFilters = () => { setFilterContract('all'); setSearch(''); };

  const totalRent = tenants.reduce((s, t) => s + (t.contractStatus === 'active' ? t.rentPerYear : 0), 0);
  const renewalSoon = tenants.filter(t => t.renewalDays !== null && t.renewalDays >= 0 && t.renewalDays <= 90).length;

  const SUMMARY = [
    { label: 'Total Customers',     value: loading ? '…' : String(tenants.length) },
    { label: 'Active Contracts',     value: loading ? '…' : String(tenants.filter(t => t.contractStatus === 'active').length) },
    { label: 'Total Active Rent',    value: loading ? '…' : `AED ${totalRent.toLocaleString('en-AE')}` },
    { label: 'Renewals Within 90d', value: loading ? '…' : String(renewalSoon) },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Customers</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">All current and past customers across the landlord’s units.</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {SUMMARY.map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            <div className="font-bold text-xl text-[#1a1916] mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 flex flex-wrap gap-3 items-center mb-4 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input
            type="text"
            placeholder="Search by name, email or unit…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
          />
        </div>
        <select value={filterContract} onChange={e => setFilterContract(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]">
          <option value="all">All Contracts</option>
          <option value="active">Active</option>
          <option value="terminated">Terminated</option>
          <option value="none">No Contract</option>
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-[#2e9f82] font-medium hover:underline flex items-center gap-1 cursor-pointer ml-auto">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[#6b6860]">{filtered.length} customer{filtered.length !== 1 ? 's' : ''} found</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-[#9b9890]">Loading customers…</div>
        ) : tenants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
              <Users size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">No customers yet</p>
            <p className="text-xs text-[#9b9890]">Customers will appear here once this landlord has active rental agreements</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[800px]">
              <thead>
                <tr className="bg-[#f4f3ef]">
                  {['Name', 'Unit', 'Property', 'Contract', 'Annual Rent', 'Renewal In'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-b border-[#e8e6e0] hover:bg-[#f4f3ef] text-sm text-[#1a1916]">
                    <td className="px-4 py-3.5">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-[#9b9890]">{t.email}</div>
                    </td>
                    <td className="px-4 py-3.5">{t.unit}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{t.asset}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5 ${CONTRACT_STYLE[t.contractStatus]}`}>
                        {CONTRACT_LABELS[t.contractStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-medium">
                      {t.contractStatus === 'active' ? `AED ${t.rentPerYear.toLocaleString('en-AE')}` : '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      {t.renewalDays !== null ? (
                        <span className={`text-xs font-medium ${t.renewalDays <= 30 ? 'text-red-600' : t.renewalDays <= 90 ? 'text-amber-600' : 'text-[#6b6860]'}`}>
                          {t.renewalDays > 0 ? `${t.renewalDays}d` : 'Expired'}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
