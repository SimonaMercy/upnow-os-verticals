'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  ImageIcon,
  Layers,
  FileText,
  History,
  Banknote,
  Users,
  Megaphone,
  ExternalLink,
} from 'lucide-react';
import { apiGet } from '@/lib/api';

/* ---------- types ---------- */

interface Property {
  id: number;
  buildingName: string;
  spaceCategory: string | null;
  fullAddress: string | null;
  emirateName: string | null;
  communityName: string | null;
}

interface Unit {
  id: number;
  propertyId: number;
  unitNumber: string | null;
  unitName: string | null;
  unitType: string | null;
  unitTier: string | null;
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
  availability: string | null;
  description: string | null;
  isListed: boolean | null;
  listingStatus: string | null;
  planLabel: string | null;
  floorPlanUrl: string | null;
}

interface UnitMedia {
  id: number;
  url: string;
  caption?: string | null;
}

interface LeaseEvent {
  kind: 'lease';
  date: string | null;
  effectiveTo: string | null;
  contractId: number | null;
  contractType: string | null;
  annualRent: number | null;
  listedPrice: number | null;
  discountAmount: number | null;
}

interface RepriceEvent {
  kind: 'reprice';
  date: string | null;
  field: string | null;
  oldPrice: number | null;
  newPrice: number | null;
  source: string | null;
  reason: string | null;
  changedByUserId: number | null;
}

type PriceEvent = LeaseEvent | RepriceEvent;

interface PriceHistory {
  unitId: number;
  unitNumber: string | null;
  currentRentalPrice: number | null;
  currentMarketPrice: number | null;
  leaseCount: number;
  repriceCount: number;
  timeline: PriceEvent[];
}

interface ContractSummary {
  id: number;
  status: string;
  contractActive: boolean;
  endDate: string | null;
  tenant: { id: number; name: string } | null;
  unit: { id: number } | null;
}

/* ---------- helpers ---------- */

const aed = (v: number | null | undefined) =>
  v === null || v === undefined ? null : `AED ${Number(v).toLocaleString('en-AE')}`;

const fmtDate = (v: string | null | undefined) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
};

const titleCase = (s: string) =>
  s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function Chip({ tone, children }: { tone: 'green' | 'amber' | 'gray'; children: React.ReactNode }) {
  const cls =
    tone === 'green'
      ? 'bg-[#dcfce7] text-[#166534]'
      : tone === 'amber'
        ? 'bg-[#fef3c7] text-[#854d0e]'
        : 'bg-[#f4f3ef] text-[#6b6860]';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

const availabilityTone = (a: string | null): 'green' | 'amber' | 'gray' => {
  const v = (a || '').toLowerCase();
  if (v === 'occupied') return 'green';
  if (v === 'reserved' || v === 'on_hold' || v === 'pending') return 'amber';
  return 'gray';
};

const listingTone = (s: string | null): 'green' | 'amber' | 'gray' => {
  const v = (s || '').toLowerCase();
  if (v === 'published') return 'green';
  if (v === 'pending' || v === 'in_review') return 'amber';
  return 'gray';
};

const contractTone = (s: string): 'green' | 'amber' | 'gray' => {
  const v = (s || '').toLowerCase();
  if (v === 'active') return 'green';
  if (v.includes('pending') || v.includes('draft') || v.includes('renew')) return 'amber';
  return 'gray';
};

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f0faf6] text-[#2e9f82]">
        {icon}
      </span>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6b6860]">{children}</h2>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-[#e8e6e0] bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/* ---------- page ---------- */

export default function UnitDetailPage() {
  const params = useParams<{ propertyId: string; unitId: string }>();
  const propertyId = Number(params.propertyId);
  const unitId = Number(params.unitId);

  const [property, setProperty] = useState<Property | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [media, setMedia] = useState<UnitMedia[]>([]);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(propertyId) || !Number.isFinite(unitId)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [prop, units] = await Promise.all([
          apiGet<Property>(`/properties/${propertyId}`),
          apiGet<Unit[]>(`/properties/${propertyId}/units`),
        ]);
        if (cancelled) return;
        setProperty(prop);
        const found = units.find((u) => u.id === unitId) || null;
        setUnit(found);
        if (!found) {
          setError('Unit not found in this property.');
          return;
        }
        // Secondary data — tolerate individual failures.
        const [m, h, c] = await Promise.allSettled([
          apiGet<UnitMedia[]>(`/properties/${propertyId}/units/${unitId}/media`),
          apiGet<PriceHistory>(`/properties/${propertyId}/units/${unitId}/price-history`),
          apiGet<ContractSummary[]>(`/contracts`),
        ]);
        if (cancelled) return;
        if (m.status === 'fulfilled') setMedia(m.value || []);
        if (h.status === 'fulfilled') setHistory(h.value);
        if (c.status === 'fulfilled') setContracts(c.value || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load unit');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, unitId]);

  /* ---------- loading / error ---------- */

  if (loading) {
    return (
      <div className="p-6">
        <Card className="flex items-center justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-[#2e9f82]" />
        </Card>
      </div>
    );
  }

  if (error || !unit) {
    return (
      <div className="p-6">
        <Link
          href={`/rental-provider/dashboard/portfolio/${propertyId}`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#6b6860] hover:text-[#2e9f82]"
        >
          <ArrowLeft className="h-4 w-4" />
          {property?.buildingName || 'Back to property'}
        </Link>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error || 'Unit not found.'}
        </div>
      </div>
    );
  }

  /* ---------- derived ---------- */

  const unitTitle = unit.unitName || `Unit ${unit.unitNumber ?? unit.id}`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentLease = contracts
    .filter((c) => c.unit?.id === unit.id)
    .filter(
      (c) =>
        (c.status || '').toLowerCase() === 'active' ||
        (c.contractActive && c.endDate && new Date(c.endDate) >= today),
    )
    .sort(
      (a, b) =>
        new Date(b.endDate || 0).getTime() - new Date(a.endDate || 0).getTime(),
    )[0];

  // One rent per unit (annual rent); marketPrice mirrors it, so no separate
  // benchmark/gap.
  const rent = unit.rentalPrice;

  const details: Array<[string, string | null]> = [
    ['Type', unit.unitType ? titleCase(unit.unitType) : null],
    ['Tier', unit.unitTier ? titleCase(unit.unitTier) : null],
    ['Floor', unit.floor],
    ['Premise no.', unit.premiseNumber],
    ['Bedrooms', unit.bedrooms != null ? String(unit.bedrooms) : null],
    ['Bathrooms', unit.bathrooms != null ? String(unit.bathrooms) : null],
    [
      'Size',
      unit.unitSizeSqft != null || unit.unitSizeSqm != null
        ? [
            unit.unitSizeSqft != null ? `${Number(unit.unitSizeSqft).toLocaleString('en-AE')} sqft` : null,
            unit.unitSizeSqm != null ? `${Number(unit.unitSizeSqm).toLocaleString('en-AE')} sqm` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : null,
    ],
    ['View', unit.view],
    ['Facilities', unit.facilities],
    ['Plan', unit.planLabel],
  ];
  const visibleDetails = details.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');

  const pricingRows: Array<[string, string | null]> = [
    ['Security deposit', aed(unit.securityDeposit)],
    ['Admin fee', aed(unit.adminFee)],
    ['Service charges', aed(unit.serviceCharges)],
  ];

  const timeline = history?.timeline ?? [];

  /* ---------- render ---------- */

  return (
    <div className="p-6">
      {/* 1. Back link */}
      <Link
        href={`/rental-provider/dashboard/portfolio/${propertyId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#6b6860] hover:text-[#2e9f82]"
      >
        <ArrowLeft className="h-4 w-4" />
        {property?.buildingName || 'Back to property'}
      </Link>

      {/* 2. Header card */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-[#1a1916]">{unitTitle}</h1>
          {unit.availability && (
            <Chip tone={availabilityTone(unit.availability)}>{titleCase(unit.availability)}</Chip>
          )}
          {unit.listingStatus && (
            <Chip tone={listingTone(unit.listingStatus)}>{titleCase(unit.listingStatus)}</Chip>
          )}
          {unit.unitType && <Chip tone="gray">{titleCase(unit.unitType)}</Chip>}
        </div>
        <p className="mt-1.5 text-sm text-[#6b6860]">
          {[
            property?.buildingName,
            unit.floor ? `Floor ${unit.floor}` : null,
            unit.premiseNumber ? `Premise ${unit.premiseNumber}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </Card>

      {/* 3. Two-column grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* MAIN column */}
        <div className="space-y-6 lg:col-span-2">
          {/* a. Photos */}
          <Card>
            <SectionTitle icon={<ImageIcon className="h-4 w-4" />}>Photos</SectionTitle>
            {media.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#9b9890]">No photos yet</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((m) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={m.id}
                    src={m.url}
                    alt={m.caption || unitTitle}
                    className="h-40 w-full rounded-xl border border-[#e8e6e0] object-cover"
                  />
                ))}
              </div>
            )}
          </Card>

          {/* b. Details */}
          <Card>
            <SectionTitle icon={<Layers className="h-4 w-4" />}>Details</SectionTitle>
            {visibleDetails.length === 0 ? (
              <p className="py-4 text-center text-sm text-[#9b9890]">No details recorded</p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                {visibleDetails.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 border-b border-[#f4f3ef] pb-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-[#9b9890]">{label}</dt>
                    <dd className="text-right text-sm font-medium text-[#1a1916]">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {unit.description && (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-[#6b6860]">
                {unit.description}
              </p>
            )}
          </Card>

          {/* c. Floor plan */}
          {unit.floorPlanUrl && (
            <Card>
              <SectionTitle icon={<FileText className="h-4 w-4" />}>Floor Plan</SectionTitle>
              <iframe
                src={unit.floorPlanUrl}
                title={`${unitTitle} floor plan`}
                className="w-full rounded-xl border border-[#e8e6e0]"
                style={{ height: 420 }}
              />
              <a
                href={unit.floorPlanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#2e9f82] hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open full size
              </a>
            </Card>
          )}

          {/* d. Price history */}
          <Card>
            <SectionTitle icon={<History className="h-4 w-4" />}>Price History</SectionTitle>
            {timeline.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#9b9890]">
                No price history yet — lease rents and repricing events will appear here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e8e6e0] text-left text-xs font-semibold uppercase tracking-wide text-[#9b9890]">
                      <th className="py-2 pr-4 font-semibold">Date</th>
                      <th className="py-2 pr-4 font-semibold">Event</th>
                      <th className="py-2 pr-4 text-right font-semibold">Price</th>
                      <th className="py-2 text-right font-semibold">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((ev, i) => {
                      if (ev.kind === 'lease') {
                        return (
                          <tr key={`lease-${i}`} className="border-b border-[#f4f3ef]">
                            <td className="py-2.5 pr-4 whitespace-nowrap text-[#1a1916]">{fmtDate(ev.date)}</td>
                            <td className="py-2.5 pr-4 text-[#6b6860]">
                              <span className="font-medium text-[#1a1916]">Lease</span>
                              {ev.contractType ? ` · ${titleCase(ev.contractType)}` : ''}
                              {ev.effectiveTo ? ` · to ${fmtDate(ev.effectiveTo)}` : ''}
                              {ev.contractId ? (
                                <>
                                  {' · '}
                                  <Link
                                    href={`/rental-provider/dashboard/contracts/${ev.contractId}/v2`}
                                    className="text-[#2e9f82] hover:underline"
                                  >
                                    #{ev.contractId}
                                  </Link>
                                </>
                              ) : null}
                            </td>
                            <td className="py-2.5 pr-4 whitespace-nowrap text-right font-medium text-[#1a1916]">
                              {aed(ev.annualRent) ?? '—'}
                            </td>
                            <td className="py-2.5 whitespace-nowrap text-right text-[#6b6860]">
                              {ev.discountAmount ? `−${Number(ev.discountAmount).toLocaleString('en-AE')} discount` : '—'}
                            </td>
                          </tr>
                        );
                      }
                      const delta =
                        ev.newPrice != null && ev.oldPrice != null ? ev.newPrice - ev.oldPrice : null;
                      return (
                        <tr key={`reprice-${i}`} className="border-b border-[#f4f3ef]">
                          <td className="py-2.5 pr-4 whitespace-nowrap text-[#1a1916]">{fmtDate(ev.date)}</td>
                          <td className="py-2.5 pr-4 text-[#6b6860]">
                            <span className="font-medium text-[#1a1916]">Repriced</span>
                            {ev.field ? ` · ${titleCase(ev.field)}` : ''}
                            {ev.reason ? ` · ${ev.reason}` : ''}
                          </td>
                          <td className="py-2.5 pr-4 whitespace-nowrap text-right font-medium text-[#1a1916]">
                            {aed(ev.newPrice) ?? '—'}
                          </td>
                          <td
                            className={`py-2.5 whitespace-nowrap text-right font-medium ${
                              delta === null
                                ? 'text-[#6b6860]'
                                : delta >= 0
                                  ? 'text-[#166534]'
                                  : 'text-red-600'
                            }`}
                          >
                            {delta === null
                              ? '—'
                              : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('en-AE')}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* SIDE column */}
        <div className="space-y-6">
          {/* a. Pricing */}
          <Card>
            <SectionTitle icon={<Banknote className="h-4 w-4" />}>Pricing</SectionTitle>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[#9b9890]">Annual rent</p>
              <p className="mt-0.5 text-2xl font-bold text-[#1a1916]">
                {rent != null ? `AED ${Number(rent).toLocaleString('en-AE')}` : '—'}
              </p>
            </div>
            <div className="mt-4 space-y-2.5">
              {pricingRows
                .filter(([, v]) => v !== null)
                .map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-[#6b6860]">{label}</span>
                    <span className="text-sm font-medium text-[#1a1916]">{value}</span>
                  </div>
                ))}
            </div>
          </Card>

          {/* b. Current tenancy */}
          <Card>
            <SectionTitle icon={<Users className="h-4 w-4" />}>Current Tenancy</SectionTitle>
            {currentLease ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[#1a1916]">
                    {currentLease.tenant?.name || 'Tenant'}
                  </span>
                  <Chip tone={contractTone(currentLease.status)}>{titleCase(currentLease.status)}</Chip>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-[#6b6860]">Lease ends</span>
                  <span className="text-sm font-medium text-[#1a1916]">{fmtDate(currentLease.endDate)}</span>
                </div>
                <Link
                  href={`/rental-provider/dashboard/contracts/${currentLease.id}/v2`}
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-[#2e9f82] hover:underline"
                >
                  Open contract
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-[#9b9890]">Vacant — no running lease</p>
            )}
          </Card>

          {/* c. Listing */}
          <Card>
            <SectionTitle icon={<Megaphone className="h-4 w-4" />}>Listing</SectionTitle>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-[#6b6860]">
                {unit.isListed ? 'Listed on marketplace' : 'Not listed'}
              </span>
              <Chip tone={listingTone(unit.listingStatus)}>
                {unit.listingStatus ? titleCase(unit.listingStatus) : 'Draft'}
              </Chip>
            </div>
            {(unit.listingStatus || '').toLowerCase() === 'published' && (
              <Link
                href={`/listings/units/${unit.id}`}
                target="_blank"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#2e9f82] hover:underline"
              >
                View public listing
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
