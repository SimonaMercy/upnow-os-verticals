/**
 * Admin property detail (read-only) — SCRUM-588 click-through target.
 * Building info + owning RP + nested units (each unit drills through to unit detail).
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, MapPin, Home, ExternalLink, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { openDocViewer } from '@/lib/docViewer';

interface UnitRow {
  id: number; unitNumber: string | null; unitName: string | null; unitType: string | null;
  availability: string | null; rentalPrice: number | null; bedrooms: number | null; listingStatus: string | null;
}
interface PropertyDetail {
  property: {
    id: number; buildingName: string | null; fullAddress: string | null; spaceCategory: string | null;
    latitude: number | null; longitude: number | null;
    numberOfFloors: string | null; makaniNumber: string | null; plotNumber: string | null;
    mapLink: string | null; leasingType: string | null; propertyDescription: string | null;
    hasGym: boolean; hasPool: boolean; hasParking: boolean;
    emirate?: { nameEn?: string | null } | null; community?: { nameEn?: string | null } | null;
  };
  financials?: {
    marketPrice: number; annualRent: number; leasedUnits: number;
    occupiedUnits: number; totalUnits: number; occupancyPct: number;
  } | null;
  unitMix?: Record<string, number> | null;
  owner: { rentalProviderId: number; userId: number | null; name: string | null } | null;
  units: UnitRow[];
  documents: { id: number; documentKey: string; displayName: string | null; fileUrl: string | null; status: string | null }[];
}

/** Whole AED — money on units/leases is stored in AED, not fils. */
const aed = (n: number | null | undefined) =>
  n == null ? '—' : `AED ${Math.round(Number(n)).toLocaleString('en-AE')}`;

const availCls: Record<string, string> = {
  available: 'bg-[#d8f2e8] text-[#1a7a5a]', occupied: 'bg-[#e8f0fb] text-[#1a5fb4]',
  maintenance: 'bg-[#fef9eb] text-[#b45309]', reserved: 'bg-[#f3effb] text-[#7c3aed]',
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
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4"><ArrowLeft size={16} /> Back</button>
      <div className="rounded-xl border border-[#e8e6e0] bg-white p-10 text-center text-[#6b6860]">Property not found — {err}</div>
    </div>
  );
  if (!d) return <div className="p-8 text-[#6b6860]">Loading…</div>;

  const p = d.property;
  const loc = [p.community?.nameEn, p.emirate?.nameEn].filter(Boolean).join(', ') || p.fullAddress || '—';
  const units = d.units;
  const listed = units.filter((u) => u.listingStatus === 'published').length;
  const occupied = units.filter((u) => u.availability === 'occupied').length;
  const available = units.filter((u) => u.availability === 'available').length;
  const fin = d.financials ?? null;
  const mix = Object.entries(d.unitMix ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4"><ArrowLeft size={16} /> Back</button>

      <div className="rounded-2xl border border-[#e8e6e0] bg-white p-6 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-[#f0faf6] text-[#1a7a5a] grid place-items-center shrink-0"><Building2 size={20} /></span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-[#1a1916] leading-tight">{p.buildingName ?? 'Property'}</h1>
              <p className="text-sm text-[#6b6860] flex items-center gap-1.5 mt-1"><MapPin size={13} /> {loc}</p>
              {p.spaceCategory && <span className="inline-block mt-2 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]">{p.spaceCategory}</span>}
            </div>
          </div>
          {d.owner && (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">Owner (RP)</div>
              {d.owner.userId ? (
                <Link href={`/dashboard/admin/users/${d.owner.userId}`} className="text-sm font-semibold text-[#1a7a5a] hover:underline inline-flex items-center gap-1">{d.owner.name ?? 'Rental Provider'} <ExternalLink size={12} /></Link>
              ) : <div className="text-sm font-semibold text-[#3f3d39]">{d.owner.name ?? '—'}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Units', value: String(units.length), sub: '' },
          { label: 'Listed', value: String(listed), sub: '' },
          { label: 'Occupancy', value: fin ? `${fin.occupancyPct}%` : `${occupied}`, sub: fin ? `${fin.occupiedUnits}/${fin.totalUnits} occupied` : 'occupied' },
          { label: 'Available', value: String(available), sub: '' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
            <div className="text-2xl font-bold text-[#1a1916] tabular-nums">{s.value}</div>
            <div className="text-xs text-[#6b6860] mt-0.5">{s.label}</div>
            {s.sub && <div className="text-[11px] text-[#9b9890] mt-0.5">{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Money for the building. Market Rent is the asking rent across every
          unit; Annual Rent is what is actually contracted, counting one
          qualifying lease per unit — so the pair reads asking vs earning.
          These two names are the platform-wide vocabulary; do not reintroduce
          "market price" or "market value" for the same figure. */}
      {fin && (fin.marketPrice > 0 || fin.annualRent > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
            <div className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">Market rent</div>
            <div className="text-2xl font-bold text-[#1a1916] tabular-nums mt-1">{aed(fin.marketPrice)}</div>
            <div className="text-[11px] text-[#9b9890] mt-0.5">asking rent · all {fin.totalUnits} units</div>
          </div>
          <div className="rounded-2xl border border-[#e8e6e0] bg-white p-4">
            <div className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">Annual rent</div>
            <div className="text-2xl font-bold text-[#1a7a5a] tabular-nums mt-1">{aed(fin.annualRent)}</div>
            <div className="text-[11px] text-[#9b9890] mt-0.5">
              contracted · {fin.leasedUnits} leased unit{fin.leasedUnits === 1 ? '' : 's'}
              {fin.marketPrice > 0 && ` · ${Math.round((fin.annualRent / fin.marketPrice) * 100)}% of asking`}
            </div>
          </div>
        </div>
      )}

      {/* Unit mix — what this building is made of. */}
      {mix.length > 0 && (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-6 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Home size={15} className="text-[#9b9890]" />
            <span className="text-sm font-semibold text-[#3f3d39]">Unit mix</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {mix.map(([type, count]) => (
              <span key={type} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#f4f3ef] text-[#6b6860]">
                <span className="capitalize">{type.replace(/_/g, ' ')}</span>
                <span className="font-semibold text-[#1a1916]">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Property details — shown before the units list */}
      <div className="rounded-2xl border border-[#e8e6e0] bg-white p-6 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={15} className="text-[#9b9890]" />
          <span className="text-sm font-semibold text-[#3f3d39]">Property Details</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
          {[
            { label: 'Category', value: p.spaceCategory?.replace(/_/g, ' ') },
            { label: 'Leasing type', value: p.leasingType },
            { label: 'Emirate', value: p.emirate?.nameEn },
            { label: 'Community', value: p.community?.nameEn },
            { label: 'Makani', value: p.makaniNumber },
            { label: 'Plot no.', value: p.plotNumber },
            { label: 'Floors', value: p.numberOfFloors },
            { label: 'Full address', value: p.fullAddress },
          ].map((f) => (
            <div key={f.label}>
              <div className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">{f.label}</div>
              <div className="text-sm text-[#3f3d39] mt-0.5 capitalize">{f.value || '—'}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {[{ label: 'Gym', on: p.hasGym }, { label: 'Pool', on: p.hasPool }, { label: 'Parking', on: p.hasParking }].map((a) => (
            <span key={a.label}
              className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${a.on ? 'bg-[#f0faf6] text-[#1a7a5a]' : 'bg-[#f4f3ef] text-[#9b9890]'}`}>
              {a.on ? <CheckCircle2 size={11} /> : <XCircle size={11} />}{a.label}
            </span>
          ))}
          {p.mapLink && (
            <a href={p.mapLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-[#f4f3ef] text-[#6b6860] hover:bg-[#e8e6e0]">
              <MapPin size={11} /> Map ↗
            </a>
          )}
        </div>

        {p.propertyDescription && (
          <p className="text-sm text-[#6b6860] leading-relaxed mt-4 pt-4 border-t border-[#f0ede8]">{p.propertyDescription}</p>
        )}
      </div>

      {/* Property documents (view-only). Unit floor plans live on each unit's detail page. */}
      <div className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden mb-5">
        <div className="px-5 py-3 border-b border-[#f0ede8] flex items-center gap-2">
          <FileText size={15} className="text-[#9b9890]" />
          <span className="text-sm font-semibold text-[#3f3d39]">Property Documents</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]">{d.documents.length}</span>
        </div>
        {d.documents.length === 0 ? (
          <div className="p-6 text-center text-[#9b9890] text-sm">No documents linked to this property. Unit floor plans appear on each unit&apos;s detail page.</div>
        ) : (
          <div className="divide-y divide-[#f0ede8]">
            {d.documents.map((doc) => {
              const ok = ['processed', 'complete', 'approved'].includes(String(doc.status).toLowerCase());
              const caption = (doc.displayName ?? doc.documentKey).replace(/_/g, ' ');
              return (
                <div key={doc.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={14} className="text-[#9b9890] shrink-0" />
                    <span className="text-sm font-medium text-[#3f3d39] truncate capitalize">{caption}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${ok ? 'bg-[#d8f2e8] text-[#1a7a5a]' : 'bg-[#fef9eb] text-[#b45309]'}`}>
                      {String(doc.status ?? 'pending').toLowerCase()}
                    </span>
                    {doc.fileUrl
                      ? <button type="button" onClick={() => openDocViewer({ fileUrl: doc.fileUrl as string, caption })}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#1a7a5a] hover:underline">
                          <ExternalLink size={12} /> View
                        </button>
                      : <span className="text-xs text-[#c4c2bc]">requested</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-[#f0ede8] flex items-center gap-2">
          <Home size={15} className="text-[#9b9890]" />
          <span className="text-sm font-semibold text-[#3f3d39]">Units</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]">{d.units.length}</span>
        </div>
        {d.units.length === 0 ? (
          <div className="p-8 text-center text-[#9b9890] text-sm">No units on this property.</div>
        ) : (
          <div className="divide-y divide-[#f0ede8]">
            {d.units.map((u) => (
              <Link key={u.id} href={`/dashboard/admin/units/${u.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[#faf9f7] transition">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#3f3d39]">{u.unitNumber ? `Unit ${u.unitNumber}` : `Unit #${u.id}`}</div>
                  <div className="text-xs text-[#6b6860]">{[u.unitType, u.bedrooms ? `${u.bedrooms} BR` : null].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {u.rentalPrice != null && <span className="text-sm font-medium text-[#3f3d39] tabular-nums">AED {u.rentalPrice.toLocaleString('en-AE')}</span>}
                  {u.availability && <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${availCls[u.availability] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>{u.availability}</span>}
                  <ExternalLink size={13} className="text-[#c4c2bc]" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
