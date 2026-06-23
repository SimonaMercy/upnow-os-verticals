/**
 * Admin unit detail (read-only) — SCRUM-588 click-through target.
 * Unit terms / rent / availability + parent property + owning RP + current tenancy.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Home, Building2, ExternalLink, FileText } from 'lucide-react';
import { apiGet } from '@/lib/api';

interface UnitDetail {
  unit: {
    id: number; unitNumber: string | null; unitName: string | null; unitType: string | null;
    availability: string | null; rentalPrice: number | null; bedrooms: number | null; bathrooms: number | null;
    floor: string | null; listingStatus: string | null; unitSizeSqm: number | null; propertyId: number;
    property?: { id: number; buildingName: string | null; fullAddress: string | null; emirate?: { nameEn?: string | null } | null; community?: { nameEn?: string | null } | null } | null;
  };
  owner: { rentalProviderId: number; userId: number | null; name: string | null } | null;
  currentTenancy: { id: number; ref: string; tenantName: string | null; tenantUserId: number | null; startDate: string | null; endDate: string | null; annualRent: number | null; status: string } | null;
}

const availCls: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-700', occupied: 'bg-blue-100 text-blue-700',
  maintenance: 'bg-amber-100 text-amber-700', reserved: 'bg-purple-100 text-purple-700',
};
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold">{label}</div>
      <div className="text-sm font-semibold text-stone-800 mt-0.5">{value}</div>
    </div>
  );
}

export default function AdminUnitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<UnitDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    apiGet<UnitDetail>(`/admin/units/${params.id}`).then(setD).catch((e) => setErr(e?.message || 'Failed to load'));
  }, [params?.id]);

  if (err) return (
    <div className="p-8">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 mb-4"><ArrowLeft size={16} /> Back</button>
      <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-stone-500">Unit not found — {err}</div>
    </div>
  );
  if (!d) return <div className="p-8 text-stone-500">Loading…</div>;

  const u = d.unit;
  const prop = u.property;
  const loc = [prop?.community?.nameEn, prop?.emirate?.nameEn].filter(Boolean).join(', ') || prop?.fullAddress || '—';

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 mb-4"><ArrowLeft size={16} /> Back</button>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 grid place-items-center shrink-0"><Home size={20} /></span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-stone-900 leading-tight">{u.unitNumber ? `Unit ${u.unitNumber}` : (u.unitName ?? `Unit #${u.id}`)}</h1>
              <Link href={`/dashboard/admin/properties/${u.propertyId}`} className="text-sm text-emerald-700 hover:underline inline-flex items-center gap-1.5 mt-1"><Building2 size={13} /> {prop?.buildingName ?? 'Property'} <ExternalLink size={11} /></Link>
              <p className="text-xs text-stone-400 mt-0.5">{loc}</p>
            </div>
          </div>
          {u.availability && <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${availCls[u.availability] ?? 'bg-stone-100 text-stone-600'}`}>{u.availability}</span>}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-stone-100">
          <Stat label="Type" value={u.unitType ?? '—'} />
          <Stat label="Bedrooms" value={u.bedrooms != null ? String(u.bedrooms) : '—'} />
          <Stat label="Bathrooms" value={u.bathrooms != null ? String(u.bathrooms) : '—'} />
          <Stat label="Size (sqm)" value={u.unitSizeSqm != null ? String(u.unitSizeSqm) : '—'} />
          <Stat label="Floor" value={u.floor ?? '—'} />
          <Stat label="Rent / yr" value={u.rentalPrice != null ? `AED ${u.rentalPrice.toLocaleString('en-AE')}` : '—'} />
          <Stat label="Listing" value={u.listingStatus ?? '—'} />
          {d.owner && <div><div className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold">Owner (RP)</div>{d.owner.userId ? <Link href={`/dashboard/admin/users/${d.owner.userId}`} className="text-sm font-semibold text-emerald-700 hover:underline mt-0.5 inline-block">{d.owner.name ?? 'RP'}</Link> : <div className="text-sm font-semibold text-stone-800 mt-0.5">{d.owner.name ?? '—'}</div>}</div>}
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex items-center gap-2 mb-3"><FileText size={15} className="text-stone-400" /><span className="text-sm font-semibold text-stone-700">Current tenancy</span></div>
        {d.currentTenancy ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <Link href={`/dashboard/admin/users/${d.currentTenancy.tenantUserId ?? ''}`} className={`text-sm font-semibold ${d.currentTenancy.tenantUserId ? 'text-emerald-700 hover:underline' : 'text-stone-800 pointer-events-none'}`}>{d.currentTenancy.tenantName ?? 'Tenant'}</Link>
              <div className="text-xs text-stone-500 mt-0.5">{d.currentTenancy.ref} · {fmtDate(d.currentTenancy.startDate)} – {fmtDate(d.currentTenancy.endDate)}</div>
            </div>
            {d.currentTenancy.annualRent != null && <span className="text-sm font-medium text-stone-700 tabular-nums">AED {d.currentTenancy.annualRent.toLocaleString('en-AE')}/yr</span>}
          </div>
        ) : (
          <div className="text-sm text-stone-400">No active tenancy — unit is {u.availability ?? 'unoccupied'}.</div>
        )}
      </div>
    </div>
  );
}
