/**
 * Admin property detail (read-only) — SCRUM-588 click-through target.
 * Building info + owning RP + nested units (each unit drills through to unit detail).
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, MapPin, Home, ExternalLink } from 'lucide-react';
import { apiGet } from '@/lib/api';

interface UnitRow {
  id: number; unitNumber: string | null; unitName: string | null; unitType: string | null;
  availability: string | null; rentalPrice: number | null; bedrooms: number | null; listingStatus: string | null;
}
interface PropertyDetail {
  property: {
    id: number; buildingName: string | null; fullAddress: string | null; spaceCategory: string | null;
    latitude: number | null; longitude: number | null;
    emirate?: { nameEn?: string | null } | null; community?: { nameEn?: string | null } | null;
  };
  owner: { rentalProviderId: number; userId: number | null; name: string | null } | null;
  units: UnitRow[];
}

const availCls: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-700', occupied: 'bg-blue-100 text-blue-700',
  maintenance: 'bg-amber-100 text-amber-700', reserved: 'bg-purple-100 text-purple-700',
};

export default function AdminPropertyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<PropertyDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    apiGet<PropertyDetail>(`/admin/properties/${params.id}`).then(setD).catch((e) => setErr(e?.message || 'Failed to load'));
  }, [params?.id]);

  if (err) return (
    <div className="p-8">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 mb-4"><ArrowLeft size={16} /> Back</button>
      <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-stone-500">Property not found — {err}</div>
    </div>
  );
  if (!d) return <div className="p-8 text-stone-500">Loading…</div>;

  const p = d.property;
  const loc = [p.community?.nameEn, p.emirate?.nameEn].filter(Boolean).join(', ') || p.fullAddress || '—';

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 mb-4"><ArrowLeft size={16} /> Back</button>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 grid place-items-center shrink-0"><Building2 size={20} /></span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-stone-900 leading-tight">{p.buildingName ?? 'Property'}</h1>
              <p className="text-sm text-stone-500 flex items-center gap-1.5 mt-1"><MapPin size={13} /> {loc}</p>
              {p.spaceCategory && <span className="inline-block mt-2 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{p.spaceCategory}</span>}
            </div>
          </div>
          {d.owner && (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold">Owner (RP)</div>
              {d.owner.userId ? (
                <Link href={`/dashboard/admin/users/${d.owner.userId}`} className="text-sm font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1">{d.owner.name ?? 'Rental Provider'} <ExternalLink size={12} /></Link>
              ) : <div className="text-sm font-semibold text-stone-700">{d.owner.name ?? '—'}</div>}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-100 flex items-center gap-2">
          <Home size={15} className="text-stone-400" />
          <span className="text-sm font-semibold text-stone-700">Units</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">{d.units.length}</span>
        </div>
        {d.units.length === 0 ? (
          <div className="p-8 text-center text-stone-400 text-sm">No units on this property.</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {d.units.map((u) => (
              <Link key={u.id} href={`/dashboard/admin/units/${u.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-stone-50 transition">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-stone-800">{u.unitNumber ? `Unit ${u.unitNumber}` : (u.unitName ?? `Unit #${u.id}`)}</div>
                  <div className="text-xs text-stone-500">{[u.unitType, u.bedrooms ? `${u.bedrooms} BR` : null].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {u.rentalPrice != null && <span className="text-sm font-medium text-stone-700 tabular-nums">AED {u.rentalPrice.toLocaleString('en-AE')}</span>}
                  {u.availability && <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${availCls[u.availability] ?? 'bg-stone-100 text-stone-600'}`}>{u.availability}</span>}
                  <ExternalLink size={13} className="text-stone-300" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
