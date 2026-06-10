'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, X, Users, Plus } from 'lucide-react';
import { CustomerForm } from '@/components/upnow/CustomerForm';

type Customer = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  leaseCount: number;
  activeLeaseCount: number;
  totalActiveRent: number;
  latestActiveEnd: string | null;
};

function calcRenewalDays(endDate: string | null): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - todayUtc) / 86400000);
}

export default function TenantsPage() {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState('all'); // all | active | inactive

  useEffect(() => {
    fetch('/api/contracts', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        // Collect raw leases per customer, then resolve the CURRENT lease per unit.
        // Imported renewals are all flagged contractActive=true, so the live lease for
        // a unit is the one with the latest start date; older same-unit leases are history.
        type Raw = { unitId: number | null; startDate: string | null; endDate: string | null; annualRent: number; status: string | null };
        const byTenant = new Map<number, { c: Customer; leases: Raw[] }>();
        for (const c of data) {
          const tid = c.tenant?.id;
          if (!tid || !c.tenant?.name) continue;
          const e = byTenant.get(tid) ?? {
            c: { id: tid, name: c.tenant.name, email: c.tenant.email ?? '', phone: c.tenant.phone ?? null, nationality: c.tenant.nationality ?? null, leaseCount: 0, activeLeaseCount: 0, totalActiveRent: 0, latestActiveEnd: null } as Customer,
            leases: [] as Raw[],
          };
          e.leases.push({ unitId: c.unit?.id ?? null, startDate: c.startDate ?? null, endDate: c.endDate ?? null, annualRent: c.annualRent ?? 0, status: c.status ?? null });
          byTenant.set(tid, e);
        }
        const TERMINAL = new Set(['terminated', 'cancelled']);
        const customers = Array.from(byTenant.values()).map(({ c, leases }) => {
          const currentByUnit = new Map<number, Raw>();
          const noUnit: Raw[] = [];
          for (const l of leases) {
            if (l.unitId == null) { noUnit.push(l); continue; }
            const cur = currentByUnit.get(l.unitId);
            if (!cur || String(l.startDate ?? '') > String(cur.startDate ?? '')) currentByUnit.set(l.unitId, l);
          }
          const current = [...currentByUnit.values(), ...noUnit].filter(l => !TERMINAL.has((l.status ?? '').toLowerCase()));
          c.leaseCount = leases.length;
          c.activeLeaseCount = current.length;
          c.totalActiveRent = current.reduce((s, l) => s + (l.annualRent ?? 0), 0);
          c.latestActiveEnd = current.reduce<string | null>((m, l) => (l.endDate && (!m || new Date(l.endDate) > new Date(m)) ? l.endDate : m), null);
          return c;
        });
        setCustomers(customers.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const filtered = customers.filter(t => {
    if (filterActive === 'active' && t.activeLeaseCount === 0) return false;
    if (filterActive === 'inactive' && t.activeLeaseCount > 0) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !t.email.toLowerCase().includes(q) && !(t.phone ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilters = filterActive !== 'all' || search !== '';
  const clearFilters = () => { setFilterActive('all'); setSearch(''); };

  const activeLeases = customers.reduce((s, t) => s + t.activeLeaseCount, 0);
  const totalRent = customers.reduce((s, t) => s + t.totalActiveRent, 0);
  const renewalSoon = customers.filter(t => {
    const d = calcRenewalDays(t.latestActiveEnd);
    return d !== null && d >= 0 && d <= 90;
  }).length;

  const SUMMARY = [
    { label: 'Total Customers',    value: loading ? '…' : String(customers.length) },
    { label: 'Active Leases',      value: loading ? '…' : String(activeLeases) },
    { label: 'Total Active Rent',  value: loading ? '…' : `AED ${totalRent.toLocaleString('en-AE')}` },
    { label: 'Renewals Within 90d', value: loading ? '…' : String(renewalSoon) },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Customers</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">All current and past customers across your units.</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full bg-[#2e9f82] text-white hover:bg-[#267a65]">
          <Plus size={15} /> Add Customer
        </button>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[#1a1916] mb-3">Add a new customer</h2>
            <CustomerForm
              mode="create"
              submitUrl="/api/contracts/tenants"
              method="POST"
              onCancel={() => setShowAdd(false)}
              onDone={(r) => {
                setShowAdd(false);
                // New customers have no contract yet (so the contract-scoped list/detail
                // won't show them); take the RP straight to the contract wizard, prefilled.
                if (r.tenantId) router.push(`/rental-provider/dashboard/contracts/new?tenantId=${r.tenantId}${r.name ? `&tenantName=${encodeURIComponent(r.name)}` : ''}`);
              }}
            />
          </div>
        </div>
      )}

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
            placeholder="Search by name, email or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
          />
        </div>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)} className="border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white text-[#3d3b35]">
          <option value="all">All Customers</option>
          <option value="active">With active lease</option>
          <option value="inactive">Without active lease</option>
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
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
              <Users size={24} className="text-[#2e9f82]" />
            </div>
            <p className="text-sm text-[#6b6860] mb-1">No customers yet</p>
            <p className="text-xs text-[#9b9890]">Customers will appear here once you have rental agreements</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[800px]">
              <thead>
                <tr className="bg-[#f4f3ef]">
                  {['Name', 'Email', 'Phone', 'Nationality', 'Leases', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-b border-[#e8e6e0] hover:bg-[#f4f3ef] text-sm text-[#1a1916]">
                    <td className="px-4 py-3.5 font-medium">{t.name}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{t.email || '—'}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{t.phone || '—'}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{t.nationality || '—'}</td>
                    <td className="px-4 py-3.5">
                      <span className="font-medium">{t.leaseCount}</span>
                      {t.activeLeaseCount > 0 && (
                        <span className="text-xs text-[#1a7a5a] ml-1.5">· {t.activeLeaseCount} active</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <Link href={`/rental-provider/dashboard/tenants/${t.id}`} className="text-sm text-[#2e9f82] font-medium hover:underline">View</Link>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#9b9890]">No customers match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
