/**
 * Admin all-units browser — every RP's units in one flat list, the unit-first
 * counterpart to the properties browser. Read-only; each row drills through to the
 * admin unit detail (which chains on to property · owner · current tenant).
 * Deep-linkable from the Overview via ?unitType= and ?availability=.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Home, Search, ChevronRight, Building2, ArrowLeft } from 'lucide-react';
import { apiGet } from '@/lib/api';

interface AdminUnit {
  id: number; unitNumber: string | null; unitName: string | null; unitType: string | null;
  availability: string | null; rentalPrice: number | null; bedrooms: number | null; sizeSqm: number | null;
  isListed: boolean; propertyId: number | null; buildingName: string | null; spaceCategory: string | null;
  fullAddress: string | null; rentalProviderId: number | null; ownerName: string | null; ownerUserId: number | null;
  contractId: number | null; tenantName: string | null; tenantUserId: number | null;
}

const titleCase = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
const aed = (v: number | null) => (v == null ? '—' : `AED ${Number(v).toLocaleString('en-AE')}`);
const availColor: Record<string, { bg: string; color: string }> = {
  occupied: { bg: '#fef9eb', color: '#b45309' },
  available: { bg: '#f0faf6', color: '#1a7a5a' },
};

export default function AdminUnitsBrowser() {
  const router = useRouter();
  const [units, setUnits] = useState<AdminUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [drill, setDrill] = useState<{ unitType?: string; availability?: string }>({});

  useEffect(() => {
    apiGet<AdminUnit[]>('/admin/units')
      .then((d) => { if (Array.isArray(d)) setUnits(d); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  // Deep-link drill filters from the Overview (?unitType=&availability=occupied).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDrill({ unitType: p.get('unitType') ?? undefined, availability: p.get('availability') ?? undefined });
  }, []);

  const filtered = useMemo(() => {
    let list = units;
    if (drill.unitType) list = list.filter((u) => (u.unitType ?? '').toLowerCase() === drill.unitType!.toLowerCase());
    if (drill.availability) list = list.filter((u) => (u.availability ?? '') === drill.availability);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((u) => [u.unitNumber, u.unitName, u.buildingName, u.fullAddress, u.ownerName, u.tenantName, u.unitType].filter(Boolean).join(' ').toLowerCase().includes(s));
    }
    return list;
  }, [units, q, drill]);

  const activeDrill = [
    drill.unitType && titleCase(drill.unitType),
    drill.availability && titleCase(drill.availability),
  ].filter(Boolean) as string[];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4"><ArrowLeft size={16} /> Back</button>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">All units</h1>
          <p className="text-sm text-[#6b6860] mt-1">{filtered.length} units across every rental provider</p>
        </div>
      </div>

      <div className="relative max-w-md mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search unit, building, owner, tenant…"
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] text-sm outline-none focus:border-[#2e9f82]" />
      </div>

      {activeDrill.length > 0 && (
        <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
          <span className="text-[#6b6860]">Filtered:</span>
          {activeDrill.map((d) => (
            <span key={d} className="px-2.5 py-1 rounded-full bg-[#f0faf6] text-[#1a7a5a] font-medium text-xs">{d}</span>
          ))}
          <Link href="/dashboard/admin/units" onClick={() => setDrill({})} className="text-xs font-semibold text-[#6b6860] hover:text-[#3f3d39] underline">Clear</Link>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-12 text-center text-[#9b9890]">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-12 text-center text-[#9b9890]">No units match.</div>
      ) : (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white divide-y divide-[#f0ede8] overflow-hidden">
          {filtered.map((u) => {
            const ac = availColor[u.availability ?? ''] ?? { bg: '#f5f4f0', color: '#6b6860' };
            return (
              <Link key={u.id} href={`/dashboard/admin/units/${u.id}`} className="flex items-center gap-4 p-4 hover:bg-[#faf9f7] transition">
                <div className="w-11 h-11 rounded-xl bg-[#f4f3ef] grid place-items-center text-[#9b9890] shrink-0">
                  <Home size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#1a1916] truncate">Unit {u.unitNumber ?? '—'}{u.unitName ? ` — ${u.unitName}` : ''}</p>
                  <p className="text-xs text-[#6b6860] truncate flex items-center gap-1 mt-0.5"><Building2 size={11} /> {u.buildingName ?? '—'}{u.fullAddress ? ` · ${u.fullAddress}` : ''}</p>
                  <p className="text-xs text-[#9b9890] mt-0.5 truncate">
                    {u.ownerName ?? `RP #${u.rentalProviderId ?? '—'}`}
                    {u.unitType ? ` · ${titleCase(u.unitType)}` : ''}
                    {u.tenantName ? ` · Tenant: ${u.tenantName}` : ''}
                  </p>
                </div>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: ac.bg, color: ac.color }}>{titleCase(u.availability)}</span>
                <span className="text-sm font-semibold text-[#3f3d39] shrink-0 w-28 text-right">{u.rentalPrice != null ? `${aed(u.rentalPrice)}/yr` : '—'}</span>
                <ChevronRight size={16} className="text-[#c4c2bc] shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
