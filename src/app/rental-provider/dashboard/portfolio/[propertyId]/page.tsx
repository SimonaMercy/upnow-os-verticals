'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronRight,
  Dumbbell,
  Hash,
  Landmark,
  Layers,
  Loader2,
  MapPin,
  ParkingCircle,
  Search,
  Waves,
} from 'lucide-react';
import { apiGet } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────

interface Property {
  id: number;
  buildingName: string;
  spaceCategory: string;
  fullAddress: string | null;
  emirateName: string | null;
  communityName: string | null;
  street: string | null;
  makaniNumber: string | null;
  plotNumber: string | null;
  latitude: number | null;
  longitude: number | null;
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  isStandaloneUnit: boolean;
  propertyDescription: string | null;
  numberOfFloors: string | null;
  createdAt: string;
}

interface Unit {
  id: number;
  propertyId: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  unitTier: string;
  floor: string | null;
  premiseNumber: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  unitSizeSqft: number | null;
  unitSizeSqm: number | null;
  view: string | null;
  facilities: string | null;
  rentalPrice: number | null;
  marketPrice: number | null;
  securityDeposit: number | null;
  adminFee: number | null;
  ejariFeeFils: number | null;
  commission: number | null;
  serviceCharges: number | null;
  availability: string;
  description: string | null;
  isListed: boolean;
  listingStatus: 'draft' | 'pending' | 'in_review' | 'published' | 'expired' | 'rejected';
  planLabel?: string | null;
  floorPlanUrl?: string | null;
}

interface ContractSummary {
  id: number;
  status: string;
  contractActive: boolean;
  endDate: string | null;
  tenant: { id: number | null; name: string | null } | null;
  unit: { id: number | null } | null;
}

// ─── Helpers ──────────────────────────────────────────────

const aed = (n: number | null | undefined) =>
  n == null ? '—' : `AED ${n.toLocaleString('en-AE')}`;

function availabilityChip(availability: string) {
  const a = (availability || '').toLowerCase();
  if (a === 'occupied') {
    return (
      <span className="inline-block rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-semibold text-[#166534]">
        Occupied
      </span>
    );
  }
  if (a === 'available') {
    return (
      <span className="inline-block rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold text-[#854d0e]">
        Available
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-[#f4f3ef] px-2 py-0.5 text-[10px] font-semibold capitalize text-[#6b6860]">
      {availability || 'Unknown'}
    </span>
  );
}

function listingChip(status: Unit['listingStatus']) {
  if (status === 'published') {
    return (
      <span className="inline-block rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-semibold text-[#166534]">
        Published
      </span>
    );
  }
  if (status === 'pending' || status === 'in_review') {
    return (
      <span className="inline-block rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold text-[#854d0e]">
        {status === 'pending' ? 'Pending' : 'In review'}
      </span>
    );
  }
  const label =
    status === 'draft' ? 'Draft' : status === 'expired' ? 'Expired' : status === 'rejected' ? 'Rejected' : status;
  return (
    <span className="inline-block rounded-full bg-[#f4f3ef] px-2 py-0.5 text-[10px] font-semibold capitalize text-[#6b6860]">
      {label}
    </span>
  );
}

/** Pick the current tenant per unit: status 'active' wins, else contractActive with endDate >= today; latest endDate breaks ties. */
function buildTenantMap(contracts: ContractSummary[]): Map<number, string> {
  const today = new Date().toISOString().slice(0, 10);
  const best = new Map<number, ContractSummary>();
  for (const c of contracts) {
    const unitId = c.unit?.id;
    if (!unitId || !c.tenant?.name) continue;
    const isCurrent =
      c.status === 'active' || (c.contractActive && !!c.endDate && c.endDate.slice(0, 10) >= today);
    if (!isCurrent) continue;
    const prev = best.get(unitId);
    if (!prev || (c.endDate || '') > (prev.endDate || '')) best.set(unitId, c);
  }
  const map = new Map<number, string>();
  best.forEach((c, unitId) => map.set(unitId, c.tenant!.name!));
  return map;
}

// ─── Page ─────────────────────────────────────────────────

export default function PropertyDetailPage() {
  const params = useParams<{ propertyId: string }>();
  const propertyId = Number(params?.propertyId);

  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [availFilter, setAvailFilter] = useState<'all' | 'occupied' | 'available'>('all');

  useEffect(() => {
    if (!Number.isFinite(propertyId)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiGet<Property>(`/properties/${propertyId}`),
      apiGet<Unit[]>(`/properties/${propertyId}/units`),
      apiGet<ContractSummary[]>(`/contracts`).catch(() => [] as ContractSummary[]),
    ])
      .then(([prop, unitList, contractList]) => {
        if (cancelled) return;
        setProperty(prop);
        setUnits(Array.isArray(unitList) ? unitList : []);
        setContracts(Array.isArray(contractList) ? contractList : []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load property');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const tenantByUnit = useMemo(() => buildTenantMap(contracts), [contracts]);

  // KPIs
  const totalUnits = units.length;
  const occupied = units.filter((u) => u.availability === 'occupied').length;
  const vacant = units.filter((u) => u.availability === 'available').length;
  const occupancyPct = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;
  const listed = units.filter((u) => u.isListed || u.listingStatus === 'published').length;
  const annualRent = units.reduce((sum, u) => sum + (u.rentalPrice ?? 0), 0);

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units.filter((u) => {
      if (availFilter !== 'all' && u.availability !== availFilter) return false;
      if (!q) return true;
      const hay = `${u.unitNumber ?? ''} ${u.unitName ?? ''} ${u.unitType ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [units, search, availFilter]);

  // ── Loading / error states ──────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center rounded-2xl border border-[#e8e6e0] bg-white py-24 shadow-sm">
          <Loader2 className="h-7 w-7 animate-spin text-[#2e9f82]" />
        </div>
      </div>
    );
  }

  if (error || !property) {
    return (
      <div className="p-6">
        <Link
          href="/rental-provider/dashboard/portfolio"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#6b6860] hover:text-[#2e9f82]"
        >
          <ArrowLeft className="h-4 w-4" /> Portfolio
        </Link>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error || 'Property not found.'}
        </div>
      </div>
    );
  }

  const addressLine =
    property.fullAddress ||
    [property.street, property.communityName, property.emirateName].filter(Boolean).join(', ');

  const hasMap = property.latitude != null && property.longitude != null;

  const kpis: { label: string; value: string }[] = [
    { label: 'Units', value: String(totalUnits) },
    { label: 'Occupied', value: String(occupied) },
    { label: 'Vacant', value: String(vacant) },
    { label: 'Occupancy', value: `${occupancyPct}%` },
    { label: 'Listed', value: String(listed) },
    { label: 'Annual rent', value: aed(annualRent) },
  ];

  return (
    <div className="p-6">
      {/* 1 — Back link */}
      <Link
        href="/rental-provider/dashboard/portfolio"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#6b6860] hover:text-[#2e9f82]"
      >
        <ArrowLeft className="h-4 w-4" /> Portfolio
      </Link>

      {/* 2 — Header card */}
      <div className="rounded-2xl border border-[#e8e6e0] bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f0faf6]">
            <Building2 className="h-6 w-6 text-[#2e9f82]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-[#1a1916]">{property.buildingName}</h1>
              {property.spaceCategory && (
                <span className="rounded-full bg-[#f4f3ef] px-2 py-0.5 text-[10px] font-semibold capitalize text-[#6b6860]">
                  {property.spaceCategory}
                </span>
              )}
              {property.isStandaloneUnit && (
                <span className="rounded-full bg-[#f4f3ef] px-2 py-0.5 text-[10px] font-semibold text-[#6b6860]">
                  Standalone unit
                </span>
              )}
            </div>

            {addressLine && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-[#6b6860]">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[#9b9890]" />
                {addressLine}
              </p>
            )}

            {/* Meta facts */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#6b6860]">
              {property.makaniNumber && (
                <span className="inline-flex items-center gap-1">
                  <Hash className="h-3.5 w-3.5 text-[#9b9890]" />
                  Makani {property.makaniNumber}
                </span>
              )}
              {property.plotNumber && (
                <span className="inline-flex items-center gap-1">
                  <Landmark className="h-3.5 w-3.5 text-[#9b9890]" />
                  Plot {property.plotNumber}
                </span>
              )}
              {property.numberOfFloors && (
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5 text-[#9b9890]" />
                  {property.numberOfFloors} floors
                </span>
              )}
              {property.createdAt && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5 text-[#9b9890]" />
                  Added{' '}
                  {new Date(property.createdAt).toLocaleDateString('en-AE', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              )}
              {hasMap && (
                <a
                  href={`https://maps.google.com/?q=${property.latitude},${property.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#2e9f82] hover:underline"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  View on map
                </a>
              )}
            </div>

            {/* Amenities */}
            {(property.hasGym || property.hasPool || property.hasParking) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {property.hasGym && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f0faf6] px-2.5 py-1 text-[11px] font-medium text-[#2e9f82]">
                    <Dumbbell className="h-3 w-3" /> Gym
                  </span>
                )}
                {property.hasPool && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f0faf6] px-2.5 py-1 text-[11px] font-medium text-[#2e9f82]">
                    <Waves className="h-3 w-3" /> Pool
                  </span>
                )}
                {property.hasParking && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f0faf6] px-2.5 py-1 text-[11px] font-medium text-[#2e9f82]">
                    <ParkingCircle className="h-3 w-3" /> Parking
                  </span>
                )}
              </div>
            )}

            {property.propertyDescription && (
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#6b6860]">
                {property.propertyDescription}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 3 — KPI tiles */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-[#e8e6e0] bg-white p-4 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">
              {kpi.label}
            </div>
            <div className="mt-1 truncate text-xl font-bold text-[#1a1916]" title={kpi.value}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* 4 — Units table */}
      <div className="mt-4 rounded-2xl border border-[#e8e6e0] bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#e8e6e0] p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6b6860]">
            Units ({filteredUnits.length})
          </h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9b9890]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search units…"
                className="w-48 rounded-lg border border-[#e8e6e0] bg-white py-1.5 pl-8 pr-3 text-sm text-[#1a1916] placeholder:text-[#9b9890] focus:border-[#2e9f82] focus:outline-none"
              />
            </div>
            <div className="flex overflow-hidden rounded-lg border border-[#e8e6e0]">
              {(
                [
                  { key: 'all', label: 'All' },
                  { key: 'occupied', label: 'Occupied' },
                  { key: 'available', label: 'Available' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setAvailFilter(opt.key)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    availFilter === opt.key
                      ? 'bg-[#f0faf6] text-[#2e9f82]'
                      : 'bg-white text-[#6b6860] hover:text-[#1a1916]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e8e6e0] text-left text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">
                <th className="px-4 py-2.5">Unit</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Beds/Baths</th>
                <th className="px-4 py-2.5">Size (sqft)</th>
                <th className="px-4 py-2.5">Floor</th>
                <th className="px-4 py-2.5 text-right">Annual rent</th>
                <th className="px-4 py-2.5 text-right">Market</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Listing</th>
                <th className="w-10 px-4 py-2.5" aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {filteredUnits.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-[#9b9890]">
                    No units match your filters.
                  </td>
                </tr>
              )}
              {filteredUnits.map((u) => {
                const unitLabel = u.unitName || `Unit ${u.unitNumber}`;
                const tenantName = tenantByUnit.get(u.id);
                const href = `/rental-provider/dashboard/portfolio/${propertyId}/units/${u.id}`;
                return (
                  <tr
                    key={u.id}
                    className="group border-b border-[#f4f3ef] transition-colors last:border-b-0 hover:bg-[#fafaf8]"
                  >
                    <td className="px-4 py-3">
                      <Link href={href} className="block">
                        <div className="font-medium text-[#1a1916] group-hover:text-[#2e9f82]">
                          {unitLabel}
                        </div>
                        {u.planLabel && (
                          <div className="text-[11px] text-[#9b9890]">{u.planLabel}</div>
                        )}
                        {tenantName && (
                          <div className="mt-0.5 text-[11px] text-[#6b6860]">{tenantName}</div>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 capitalize text-[#6b6860]">
                      <Link href={href} className="block">
                        {u.unitType || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#6b6860]">
                      <Link href={href} className="block">
                        {u.bedrooms != null || u.bathrooms != null
                          ? `${u.bedrooms ?? '—'} / ${u.bathrooms ?? '—'}`
                          : '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#6b6860]">
                      <Link href={href} className="block">
                        {u.unitSizeSqft != null ? u.unitSizeSqft.toLocaleString('en-AE') : '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#6b6860]">
                      <Link href={href} className="block">
                        {u.floor || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[#1a1916]">
                      <Link href={href} className="block">
                        {u.rentalPrice != null ? u.rentalPrice.toLocaleString('en-AE') : '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right text-[#6b6860]">
                      <Link href={href} className="block">
                        {u.marketPrice != null ? u.marketPrice.toLocaleString('en-AE') : '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={href} className="block">
                        {availabilityChip(u.availability)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={href} className="block">
                        {listingChip(u.listingStatus)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={href} className="block" aria-label={`Open ${unitLabel}`}>
                        <ChevronRight className="h-4 w-4 text-[#9b9890] group-hover:text-[#2e9f82]" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
