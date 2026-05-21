'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Building2, RefreshCw, Eye, EyeOff,
  CheckCircle2, XCircle, Clock, AlertCircle,
  ChevronLeft, ChevronRight, ImageOff,
  MapPin, DollarSign, Info, Tag, MousePointerClick, TrendingUp,
} from 'lucide-react';
import { DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { apiGet, apiPatch } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminProperty {
  id: number;
  buildingName: string;
  fullAddress: string | null;
  spaceCategory: string;
  rentalProviderId: number;
  unitCount: number;
  listedCount: number;
  createdAt: string;
}

type ListingStatus = 'draft' | 'pending' | 'in_review' | 'published' | 'rejected' | 'expired';

interface PendingUnit {
  id: number;
  propertyId: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  listingStatus: ListingStatus;
  rentPerAnnum: number | null;
  rentPerMonth: number | null;
  property: {
    id: number;
    buildingName: string;
    fullAddress: string | null;
    rentalProviderId: number;
    spaceCategory: string;
  };
}

interface UnitMedia {
  id: number;
  url: string;
  caption: string | null;
  mediaType: string;
  sortOrder: number;
}

interface UnitDetail {
  id: number;
  unitNumber: string;
  unitName: string | null;
  floor: string | null;
  unitType: string;
  unitTier: string;
  premiseNumber: string | null;
  unitSizeSqft: number | null;
  unitSizeSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  kitchenType: string | null;
  numBalconies: number;
  view: string | null;
  facilities: string | null;
  numAcs: number;
  numHeaters: number;
  numWindows: number;
  numDoors: number;
  marketPrice: number | null;
  rentalPrice: number | null;
  leaseAmount: number | null;
  serviceCharges: number | null;
  securityDeposit: number | null;
  adminFee: number | null;
  ejariFeeFils: number | null;
  commission: number | null;
  availability: string;
  description: string | null;
  listingStatus: ListingStatus;
  serviceTier: string | null;
  createdAt: string;
  property: {
    id: number;
    buildingName: string;
    fullAddress: string | null;
    spaceCategory: string;
    rentalProviderId: number;
    numberOfFloors: string | null;
    hasGym: boolean;
    hasPool: boolean;
    hasParking: boolean;
    propertyDescription: string | null;
    makaniNumber: string | null;
    plotNumber: string | null;
    mapLink: string | null;
    emirate?: { name: string } | null;
    city?: { name: string } | null;
    community?: { name: string } | null;
    subCommunity?: { name: string } | null;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const categoryLabel: Record<string, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
};

const categoryColor: Record<string, { bg: string; color: string }> = {
  residential: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  commercial:  { bg: '#eff6ff', color: '#3b82f6' },
  industrial:  { bg: '#f5f3ff', color: '#8b5cf6' },
};

const statusCfg: Record<ListingStatus, { label: string; className: string; Icon: React.ElementType }> = {
  draft:     { label: 'Draft',      className: 'bg-gray-100 text-gray-600',       Icon: EyeOff },
  pending:   { label: 'Pending',    className: 'bg-amber-100 text-amber-700',     Icon: Clock },
  in_review: { label: 'In Review',  className: 'bg-blue-100 text-blue-700',       Icon: AlertCircle },
  published: { label: 'Published',  className: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 },
  rejected:  { label: 'Rejected',   className: 'bg-red-100 text-red-700',         Icon: XCircle },
  expired:   { label: 'Expired',    className: 'bg-orange-100 text-orange-700',   Icon: XCircle },
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function aed(v: number | null | undefined) {
  if (v == null) return '—';
  return `AED ${Number(v).toLocaleString('en-AE')}`;
}


function StatusBadge({ s }: { s: ListingStatus }) {
  const cfg = statusCfg[s] ?? statusCfg.draft;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      <Icon size={10} />{cfg.label}
    </span>
  );
}

function CategoryFilters({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(['', 'residential', 'commercial', 'industrial'] as const).map((cat) => (
        <button key={cat} onClick={() => onChange(cat)}
          className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
          style={value === cat
            ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
            : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>
          {cat ? categoryLabel[cat] : 'All'}
        </button>
      ))}
    </div>
  );
}

function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  function pages(cur: number, tot: number): (number | null)[] {
    if (tot <= 5) return Array.from({ length: tot }, (_, i) => i);
    const out: (number | null)[] = [0];
    if (cur > 2) out.push(null);
    for (let p = Math.max(1, cur - 1); p <= Math.min(tot - 2, cur + 1); p++) out.push(p);
    if (cur < tot - 3) out.push(null);
    out.push(tot - 1);
    return out.slice(0, 7);
  }

  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-t" style={{ borderColor: 'var(--color-base-100)' }}>
      <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-0.5">
        <button onClick={() => onChange(page - 1)} disabled={page === 0}
          className="p-1 rounded disabled:opacity-30 hover:bg-base-100">
          <ChevronLeft size={14} style={{ color: 'var(--color-neutral-500)' }} />
        </button>
        {pages(page, totalPages).map((p, i) =>
          p === null
            ? <span key={`e${i}`} className="w-6 text-center text-xs" style={{ color: 'var(--color-neutral-400)' }}>…</span>
            : <button key={p} onClick={() => onChange(p)}
                className="w-6 h-6 rounded text-xs font-medium"
                style={p === page
                  ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                  : { color: 'var(--color-neutral-600)' }}>
                {p + 1}
              </button>
        )}
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages - 1}
          className="p-1 rounded disabled:opacity-30 hover:bg-base-100">
          <ChevronRight size={14} style={{ color: 'var(--color-neutral-500)' }} />
        </button>
      </div>
    </div>
  );
}

// ─── Left panel card ──────────────────────────────────────────────────────────

function UnitCard({ unit, selected, onClick }: { unit: PendingUnit; selected: boolean; onClick: () => void }) {
  const cc = categoryColor[unit.property.spaceCategory] ?? { bg: 'var(--color-base-100)', color: 'var(--color-neutral-500)' };
  const rent = unit.rentPerAnnum != null
    ? `AED ${Number(unit.rentPerAnnum).toLocaleString()}/yr`
    : unit.rentPerMonth != null
    ? `AED ${(Number(unit.rentPerMonth) * 12).toLocaleString()}/yr`
    : null;
  const overPct = indexDeviation(unit);

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3.5 border-b transition-colors relative"
      style={{
        borderColor: 'var(--color-base-100)',
        backgroundColor: selected ? 'var(--color-primary-50)' : '#fff',
        borderLeft: selected ? '3px solid var(--color-primary)' : '3px solid transparent',
      }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>
          Unit {unit.unitNumber}{unit.unitName ? ` — ${unit.unitName}` : ''}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {overPct !== null && (
            <span className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: overPct >= 35 ? '#fef2f2' : '#fef9eb', color: overPct >= 35 ? '#dc2626' : '#b45309' }}>
              <TrendingUp size={9} />+{overPct}%
            </span>
          )}
          <StatusBadge s={unit.listingStatus} />
        </div>
      </div>

      {/* Building */}
      <p className="text-xs truncate mb-1.5" style={{ color: 'var(--color-neutral-600)' }}>
        {unit.property.buildingName}
      </p>
      {unit.property.fullAddress && (
        <p className="text-xs truncate mb-1.5" style={{ color: 'var(--color-neutral-400)' }}>
          {unit.property.fullAddress}
        </p>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: cc.bg, color: cc.color }}>
          {categoryLabel[unit.property.spaceCategory] ?? unit.property.spaceCategory}
        </span>
        <div className="flex items-center gap-2">
          {rent && <span className="text-xs font-medium" style={{ color: 'var(--color-neutral-700)' }}>{rent}</span>}
          <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>RP #{unit.property.rentalProviderId}</span>
        </div>
      </div>
    </button>
  );
}

// ─── Right panel — detail view ────────────────────────────────────────────────

function UnitDetailPanel({
  unit: row,
  onApprove,
  onReject,
  acting,
}: {
  unit: PendingUnit;
  onApprove: (u: PendingUnit) => Promise<void>;
  onReject: (u: PendingUnit) => Promise<void>;
  acting: boolean;
}) {
  const [detail, setDetail] = useState<UnitDetail | null>(null);
  const [media, setMedia] = useState<UnitMedia[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDetail(null);
    setMedia([]);
    setPhotoIdx(0);
    setLoadingDetail(true);
    setDetailError(null);
    scrollRef.current?.scrollTo({ top: 0 });

    apiGet<{ unit: UnitDetail; media: UnitMedia[] }>(`/admin/listings/${row.propertyId}/units/${row.id}`)
      .then((r) => { setDetail(r.unit); setMedia(r.media); })
      .catch((e) => setDetailError((e as Error).message))
      .finally(() => setLoadingDetail(false));
  }, [row.id, row.propertyId]);

  const photos = media.filter((m) => m.mediaType === 'photo');
  const p = detail?.property;
  const locationParts = [p?.emirate?.name, p?.community?.name, p?.subCommunity?.name].filter(Boolean);

  const checklistItems = [
    {
      label: 'Photos',
      ok: photos.length >= 1,
      note: photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'None',
    },
    {
      label: 'Rental price',
      ok: !!detail?.rentalPrice,
      note: detail?.rentalPrice ? aed(detail.rentalPrice) : 'Not set',
    },
    {
      label: 'Unit size',
      ok: !!(detail?.unitSizeSqft || detail?.unitSizeSqm),
      note: detail?.unitSizeSqft ? `${Number(detail.unitSizeSqft).toLocaleString()} sqft` : 'Not set',
    },
    {
      label: 'Description',
      ok: !!(detail?.description || detail?.property?.propertyDescription),
      note: (detail?.description || detail?.property?.propertyDescription) ? 'Present' : 'Missing',
    },
    {
      label: 'Availability',
      ok: !!detail?.availability,
      note: detail?.availability?.replace(/_/g, ' ') ?? 'Not set',
    },
    {
      label: 'Unit type',
      ok: !!detail?.unitType,
      note: detail?.unitType?.replace(/_/g, ' ') ?? 'Not set',
    },
  ];

  const checklistPass = checklistItems.filter((c) => c.ok).length;

  return (
    <div className="flex flex-col h-full">

      {/* Body: checklist column + detail scroll column */}
      <div className="flex flex-1 min-h-0">

        {/* LEFT — vertical checklist strip */}
        <div className="flex flex-col shrink-0 border-r overflow-y-auto p-3 gap-2"
          style={{ width: 168, borderColor: 'var(--color-base-200)', backgroundColor: '#fafdf9' }}>

          {/* Score */}
          <div className="rounded-lg px-2 py-2 text-center" style={{ backgroundColor: checklistPass === checklistItems.length ? '#dcfce7' : '#fef9eb' }}>
            <p className="text-lg font-bold leading-none" style={{ color: checklistPass === checklistItems.length ? '#16a34a' : '#b45309' }}>
              {checklistPass}/{checklistItems.length}
            </p>
            <p className="text-xs mt-0.5" style={{ color: checklistPass === checklistItems.length ? '#166534' : '#92400e' }}>
              {checklistPass === checklistItems.length ? 'Ready' : 'Incomplete'}
            </p>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wide px-1" style={{ color: 'var(--color-neutral-400)' }}>
            Checklist
          </p>

          {checklistItems.map(({ label, ok, note }) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-lg p-2"
              style={{ backgroundColor: ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}` }}>
              <div className="flex items-center gap-1.5">
                {ok
                  ? <CheckCircle2 size={11} style={{ color: '#16a34a', flexShrink: 0 }} />
                  : <XCircle size={11} style={{ color: '#dc2626', flexShrink: 0 }} />}
                <span className="text-xs font-semibold leading-tight" style={{ color: ok ? '#15803d' : '#b91c1c' }}>
                  {label}
                </span>
              </div>
              <p className="text-xs pl-4 leading-tight truncate" style={{ color: ok ? '#166534' : '#dc2626', opacity: 0.8 }}>
                {note}
              </p>
            </div>
          ))}
        </div>

        {/* RIGHT — scrollable detail */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">

          {/* Header */}
          <div className="mb-3 pb-3 border-b" style={{ borderColor: 'var(--color-base-100)' }}>
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
                Unit {row.unitNumber}{row.unitName ? ` — ${row.unitName}` : ''}
              </h2>
              <StatusBadge s={row.listingStatus} />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>
              {row.property.buildingName} · RP #{row.property.rentalProviderId}
            </p>
          </div>

          {loadingDetail && (
            <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--color-neutral-400)' }}>
              Loading details…
            </div>
          )}

          {!loadingDetail && detailError && (
            <div className="text-sm p-3 rounded-xl" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
              {detailError}
            </div>
          )}

          {!loadingDetail && detail && (
          <div className="space-y-3">

            {/* ── Photos ─────────────────────────────────────── */}
            {photos.length > 0 ? (
              <div>
                <div className="relative rounded-xl overflow-hidden bg-gray-100" style={{ height: 160 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photos[photoIdx]?.url} alt={photos[photoIdx]?.caption ?? ''}
                    className="w-full h-full object-cover" />
                  {photos.length > 1 && (
                    <>
                      <button onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/40 text-white hover:bg-black/60">
                        <ChevronLeft size={13} />
                      </button>
                      <button onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/40 text-white hover:bg-black/60">
                        <ChevronRight size={13} />
                      </button>
                      <span className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-full bg-black/40 text-white">
                        {photoIdx + 1}/{photos.length}
                      </span>
                    </>
                  )}
                </div>
                {photos.length > 1 && (
                  <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                    {photos.map((ph, i) => (
                      <button key={ph.id} onClick={() => setPhotoIdx(i)}
                        className="shrink-0 rounded-lg overflow-hidden"
                        style={{ width: 36, height: 36, outline: i === photoIdx ? '2px solid var(--color-primary)' : '2px solid transparent', outlineOffset: 1 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ph.url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl p-3"
                style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
                <ImageOff size={14} style={{ color: '#dc2626', flexShrink: 0 }} />
                <p className="text-xs font-medium" style={{ color: '#dc2626' }}>No photos — required for approval</p>
              </div>
            )}

            {/* ── Location ───────────────────────────────────── */}
            <div className="rounded-xl p-3" style={{ backgroundColor: '#fff', border: '1px solid var(--color-base-200)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <MapPin size={12} style={{ color: 'var(--color-primary)' }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-neutral-500)' }}>Location</span>
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>{p?.buildingName ?? '—'}</p>
              {locationParts.length > 0 && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>{locationParts.join(' › ')}</p>
              )}
              {p?.fullAddress && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-400)' }}>{p.fullAddress}</p>
              )}
              {(p?.makaniNumber || p?.numberOfFloors || p?.mapLink) && (
                <div className="flex flex-wrap gap-x-3 mt-1.5">
                  {p?.makaniNumber && <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>Makani: {p.makaniNumber}</span>}
                  {p?.numberOfFloors && <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>{p.numberOfFloors} floors</span>}
                  {p?.mapLink && <a href={p.mapLink} target="_blank" rel="noopener noreferrer" className="text-xs" style={{ color: 'var(--color-primary)' }}>Map ↗</a>}
                </div>
              )}
            </div>

            {/* ── Unit specs ─────────────────────────────────── */}
            <div className="rounded-xl p-3" style={{ backgroundColor: '#fff', border: '1px solid var(--color-base-200)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Info size={12} style={{ color: 'var(--color-primary)' }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-neutral-500)' }}>Unit Specs</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3">
                {[
                  { label: 'Type',       value: detail.unitType?.replace(/_/g, ' ') ?? '—' },
                  { label: 'Floor',      value: detail.floor ?? '—' },
                  { label: 'Available',  value: detail.availability?.replace(/_/g, ' ') ?? '—' },
                  { label: 'Tier',       value: detail.unitTier?.replace(/_/g, ' ') ?? '—' },
                  { label: 'Beds',       value: detail.bedrooms != null ? String(detail.bedrooms) : '—' },
                  { label: 'Baths',      value: detail.bathrooms != null ? String(detail.bathrooms) : '—' },
                  { label: 'Balconies',  value: String(detail.numBalconies ?? 0) },
                  { label: 'ACs',        value: String(detail.numAcs ?? 0) },
                  { label: 'sqft',       value: detail.unitSizeSqft ? Number(detail.unitSizeSqft).toLocaleString() : '—' },
                  { label: 'sqm',        value: detail.unitSizeSqm  ? Number(detail.unitSizeSqm).toLocaleString()  : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b"
                    style={{ borderColor: 'var(--color-base-100)' }}>
                    <span className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>{label}</span>
                    <span className="text-xs font-semibold"
                      style={{ color: value === '—' ? 'var(--color-neutral-300)' : 'var(--color-neutral-800)' }}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Pricing ────────────────────────────────────── */}
            <div className="rounded-xl p-3" style={{ backgroundColor: '#fff', border: '1px solid var(--color-base-200)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <DollarSign size={12} style={{ color: 'var(--color-primary)' }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-neutral-500)' }}>Pricing</span>
              </div>
              <div className="rounded-lg p-2.5 mb-2.5" style={{ backgroundColor: 'var(--color-primary-50)' }}>
                <p className="text-xs" style={{ color: 'var(--color-primary)' }}>Annual Rent</p>
                <p className="text-lg font-bold" style={{ color: 'var(--color-primary)' }}>{aed(detail.rentalPrice)}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  { label: 'Security deposit', value: aed(detail.securityDeposit) },
                  { label: 'Service charges',  value: aed(detail.serviceCharges) },
                  { label: 'Admin fee',        value: aed(detail.adminFee) },
                  { label: 'Ejari fee',        value: aed(detail.ejariFeeFils) },
                  { label: 'Commission',       value: aed(detail.commission) },
                  { label: 'Market price',     value: aed(detail.marketPrice) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs" style={{ color: 'var(--color-neutral-400)' }}>{label}</p>
                    <p className="text-xs font-semibold mt-0.5"
                      style={{ color: value === '—' ? 'var(--color-neutral-300)' : 'var(--color-neutral-800)' }}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Amenities ──────────────────────────────────── */}
            <div className="rounded-xl p-3" style={{ backgroundColor: '#fff', border: '1px solid var(--color-base-200)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Tag size={12} style={{ color: 'var(--color-primary)' }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-neutral-500)' }}>Amenities & Extras</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: 'Gym',     active: p?.hasGym },
                  { label: 'Pool',    active: p?.hasPool },
                  { label: 'Parking', active: p?.hasParking },
                ].map(({ label, active }) => (
                  <span key={label}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
                    style={active
                      ? { backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }
                      : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-400)' }}>
                    {active ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                    {label}
                  </span>
                ))}
                {detail.view && (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{ backgroundColor: '#eff6ff', color: '#3b82f6' }}>
                    {detail.view} view
                  </span>
                )}
                {detail.kitchenType && (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>
                    {detail.kitchenType} kitchen
                  </span>
                )}
              </div>
            </div>

            {/* ── Description ────────────────────────────────── */}
            {(detail.description || p?.propertyDescription) && (
              <div className="rounded-xl p-3" style={{ backgroundColor: '#fff', border: '1px solid var(--color-base-200)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Info size={12} style={{ color: 'var(--color-primary)' }} />
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-neutral-500)' }}>Description</span>
                </div>
                {detail.description && (
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-neutral-700)' }}>{detail.description}</p>
                )}
                {detail.description && p?.propertyDescription && (
                  <hr className="my-2" style={{ borderColor: 'var(--color-base-100)' }} />
                )}
                {p?.propertyDescription && (
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-neutral-600)' }}>{p.propertyDescription}</p>
                )}
              </div>
            )}

          </div>
          )}

        </div>{/* end right scroll column */}
      </div>{/* end body flex row */}

      {/* Sticky action bar — full width */}
      <div className="shrink-0 px-4 py-3 border-t flex gap-3" style={{ borderColor: 'var(--color-base-200)', backgroundColor: '#fff' }}>
        <button
          onClick={() => void onApprove(row)}
          disabled={acting || loadingDetail}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}
        >
          <CheckCircle2 size={15} /> Approve
        </button>
        <button
          onClick={() => void onReject(row)}
          disabled={acting || loadingDetail}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}
        >
          <XCircle size={15} /> Reject
        </button>
      </div>
    </div>
  );
}

// ─── RERA Rental Index helpers ────────────────────────────────────────────────

// Indicative Q1 2026 RERA index caps (AED/yr) by space category.
// Units priced more than 20% above these caps are flagged for review.
const RERA_INDEX_CAP: Record<string, number> = {
  residential: 145000,
  commercial:  270000,
  industrial:  160000,
};

function indexDeviation(unit: PendingUnit): number | null {
  const rent =
    unit.rentPerAnnum != null
      ? Number(unit.rentPerAnnum)
      : unit.rentPerMonth != null
      ? Number(unit.rentPerMonth) * 12
      : null;
  if (!rent) return null;
  const cap = RERA_INDEX_CAP[unit.property.spaceCategory] ?? 200000;
  const pct = Math.round(((rent - cap) / cap) * 100);
  return pct >= 20 ? pct : null;
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'queue' | 'all';

export default function AdminListingsPage() {
  const [tab, setTab] = useState<Tab>('queue');

  // Queue state
  const [queueData, setQueueData]       = useState<PendingUnit[]>([]);
  const [queueTotal, setQueueTotal]     = useState(0);
  const [queuePage, setQueuePage]       = useState(0);
  const [queueCategory, setQueueCategory] = useState('');
  const [queueLoading, setQueueLoading] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<PendingUnit | null>(null);
  const [queueOverIndex, setQueueOverIndex] = useState(false);

  // All-properties state
  const [propsData, setPropsData]       = useState<AdminProperty[]>([]);
  const [propsTotal, setPropsTotal]     = useState(0);
  const [propsPage, setPropsPage]       = useState(0);
  const [propsCategory, setPropsCategory] = useState('');
  const [propsLoading, setPropsLoading] = useState(false);

  const [error, setError]   = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  // Summary totals (unfiltered)
  const [summaryProps,   setSummaryProps]   = useState(0);
  const [summaryUnits,   setSummaryUnits]   = useState(0);
  const [summaryListed,  setSummaryListed]  = useState(0);
  const [summaryPending, setSummaryPending] = useState(0);

  const fetchQueue = useCallback(async (page: number, category: string) => {
    setQueueLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), ...(category ? { spaceCategory: category } : {}) });
      const resp = await apiGet<{ data: PendingUnit[]; total: number }>(`/admin/listings/pending?${params}`);
      setQueueData(resp.data ?? []);
      setQueueTotal(resp.total ?? 0);
      if (!category) setSummaryPending(resp.total ?? 0);
    } catch (err) { setError((err as Error).message); }
    finally { setQueueLoading(false); }
  }, []);

  const fetchProps = useCallback(async (page: number, category: string) => {
    setPropsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), ...(category ? { spaceCategory: category } : {}) });
      const resp = await apiGet<{ data: AdminProperty[]; total: number }>(`/admin/properties?${params}`);
      setPropsData(resp.data ?? []);
      setPropsTotal(resp.total ?? 0);
      if (!category) {
        setSummaryProps(resp.total ?? 0);
        setSummaryUnits((resp.data ?? []).reduce((s, p) => s + p.unitCount, 0));
        setSummaryListed((resp.data ?? []).reduce((s, p) => s + p.listedCount, 0));
      }
    } catch (err) { setError((err as Error).message); }
    finally { setPropsLoading(false); }
  }, []);

  useEffect(() => { void fetchQueue(0, ''); void fetchProps(0, ''); }, [fetchQueue, fetchProps]);
  useEffect(() => { void fetchQueue(queuePage, queueCategory); }, [queuePage, queueCategory, fetchQueue]);
  useEffect(() => { void fetchProps(propsPage, propsCategory); }, [propsPage, propsCategory, fetchProps]);

  const visibleQueue = queueOverIndex ? queueData.filter((u) => indexDeviation(u) !== null) : queueData;
  const overIndexCount = queueData.filter((u) => indexDeviation(u) !== null).length;

  function handleQueueCategory(cat: string) { setQueueCategory(cat); setQueuePage(0); setSelectedUnit(null); setQueueOverIndex(false); }
  function handlePropsCategory(cat: string) { setPropsCategory(cat); setPropsPage(0); }
  function handleToggleOverIndex() { setQueueOverIndex((v) => !v); setSelectedUnit(null); }

  async function handleApprove(unit: PendingUnit) {
    if (!confirm(`Approve unit ${unit.unitNumber} at ${unit.property.buildingName}?`)) return;
    setActing(true);
    try {
      await apiPatch(`/admin/listings/${unit.propertyId}/units/${unit.id}/approve`, {});
      setQueueData((prev) => prev.filter((u) => u.id !== unit.id));
      setQueueTotal((t) => Math.max(0, t - 1));
      setSummaryPending((t) => Math.max(0, t - 1));
      // auto-select next unit
      setSelectedUnit((prev) => {
        const idx = queueData.findIndex((u) => u.id === prev?.id);
        return queueData[idx + 1] ?? queueData[idx - 1] ?? null;
      });
    } catch (err) { alert((err as Error).message); }
    finally { setActing(false); }
  }

  async function handleReject(unit: PendingUnit) {
    if (!confirm(`Reject unit ${unit.unitNumber} at ${unit.property.buildingName}?`)) return;
    setActing(true);
    try {
      await apiPatch(`/admin/listings/${unit.propertyId}/units/${unit.id}/reject`, {});
      setQueueData((prev) => prev.filter((u) => u.id !== unit.id));
      setQueueTotal((t) => Math.max(0, t - 1));
      setSummaryPending((t) => Math.max(0, t - 1));
      setSelectedUnit((prev) => {
        const idx = queueData.findIndex((u) => u.id === prev?.id);
        return queueData[idx + 1] ?? queueData[idx - 1] ?? null;
      });
    } catch (err) { alert((err as Error).message); }
    finally { setActing(false); }
  }

  const loading = queueLoading || propsLoading;

  return (
    <div className="flex flex-col h-full" style={{ padding: '12px 20px 16px' }}>

      {/* Single header row: title · tabs · stats · refresh */}
      <div className="flex items-center gap-1 pb-2 border-b flex-shrink-0" style={{ borderColor: 'var(--color-base-200)' }}>

        {/* Page title */}
        <span className="text-sm font-bold mr-3 shrink-0" style={{ color: 'var(--color-neutral-900)' }}>Listings</span>

        {/* Tabs */}
        {([
          { id: 'queue' as Tab, label: 'Approval Queue', count: summaryPending },
          { id: 'all'   as Tab, label: 'All Properties', count: summaryProps },
        ]).map(({ id, label, count }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-[9px] transition-colors"
            style={tab === id
              ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }
              : { borderColor: 'transparent', color: 'var(--color-neutral-500)' }}>
            {label}
            <span className="text-xs px-1.5 py-0.5 rounded-full"
              style={tab === id
                ? { backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }
                : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>
              {count}
            </span>
          </button>
        ))}

        {/* Compact stats strip */}
        <div className="ml-auto flex items-center gap-3 mr-2">
          {[
            { label: 'Properties', value: summaryProps },
            { label: 'Units',      value: summaryUnits },
            { label: 'Listed',     value: summaryListed },
            { label: 'Pending',    value: summaryPending, highlight: true },
          ].map(({ label, value, highlight }, i, arr) => (
            <span key={label} className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs">
                <span className="font-semibold" style={{ color: highlight ? 'var(--color-primary)' : 'var(--color-neutral-700)' }}>{value}</span>
                <span style={{ color: 'var(--color-neutral-400)' }}>{label}</span>
              </span>
              {i < arr.length - 1 && <span style={{ color: 'var(--color-base-200)' }}>·</span>}
            </span>
          ))}
        </div>

        <button onClick={() => { void fetchQueue(queuePage, queueCategory); void fetchProps(propsPage, propsCategory); }}
          disabled={loading}
          className="p-1.5 rounded-lg transition-colors hover:bg-base-100"
          style={{ border: '1px solid var(--color-base-200)' }} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--color-neutral-500)' }} />
        </button>
      </div>

      {error && (
        <div className="rounded-xl p-2 mt-2 text-sm flex-shrink-0" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>{error}</div>
      )}

      {/* ── Approval Queue — split panel ──────────────────── */}
      {tab === 'queue' && (
        <div className="flex flex-col flex-1 min-h-0 mt-2">
          {/* Filters row */}
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <CategoryFilters value={queueCategory} onChange={handleQueueCategory} />

            {/* RERA index filter chip */}
            {overIndexCount > 0 && (
              <button
                onClick={handleToggleOverIndex}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0"
                style={queueOverIndex
                  ? { backgroundColor: '#b45309', color: '#fff' }
                  : { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                <TrendingUp size={11} />
                Exceeds RERA Index ({overIndexCount})
              </button>
            )}

            {queueTotal > 0 && (
              <span className="text-xs ml-auto shrink-0" style={{ color: 'var(--color-neutral-400)' }}>
                {queueOverIndex ? `${visibleQueue.length} of ${queueTotal}` : `${queueTotal}`} unit{queueTotal !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {queueLoading && (
            <div className="rounded-2xl p-8 bg-white text-center text-sm flex-shrink-0" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>
              Loading…
            </div>
          )}

          {!queueLoading && visibleQueue.length === 0 && (
            <DashboardEmpty message={
              queueOverIndex ? 'No listings exceed the RERA Rental Index on this page.' :
              queueCategory ? `No ${categoryLabel[queueCategory]?.toLowerCase()} units pending approval.` :
              'No listings pending approval — you\'re all caught up.'
            } />
          )}

          {!queueLoading && visibleQueue.length > 0 && (
            /* Split panel — fills remaining height */
            <div
              className="flex rounded-2xl overflow-hidden border flex-1 min-h-0"
              style={{
                borderColor: 'var(--color-base-200)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {/* LEFT — list */}
              <div className="flex flex-col shrink-0 border-r overflow-hidden"
                style={{ width: 360, borderColor: 'var(--color-base-200)', backgroundColor: '#fff' }}>
                <div className="flex-1 overflow-y-auto">
                  {visibleQueue.map((unit) => (
                    <UnitCard
                      key={unit.id}
                      unit={unit}
                      selected={selectedUnit?.id === unit.id}
                      onClick={() => setSelectedUnit(unit)}
                    />
                  ))}
                </div>
                {!queueOverIndex && <Pagination page={queuePage} total={queueTotal} pageSize={PAGE_SIZE} onChange={(p) => { setQueuePage(p); setSelectedUnit(null); }} />}
              </div>

              {/* RIGHT — detail */}
              <div className="flex-1 overflow-hidden" style={{ backgroundColor: '#fafafa' }}>
                {selectedUnit ? (
                  <UnitDetailPanel
                    unit={selectedUnit}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    acting={acting}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3"
                    style={{ color: 'var(--color-neutral-400)' }}>
                    <MousePointerClick size={32} strokeWidth={1.5} />
                    <p className="text-sm">Select a listing to review</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── All Properties ────────────────────────────────── */}
      {tab === 'all' && (
        <div className="flex flex-col flex-1 min-h-0 mt-2 overflow-y-auto">
          <div className="mb-2 flex-shrink-0">
            <CategoryFilters value={propsCategory} onChange={handlePropsCategory} />
          </div>

          {propsLoading && (
            <div className="rounded-2xl p-8 bg-white text-center text-sm" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>
              Loading…
            </div>
          )}
          {!propsLoading && propsData.length === 0 && (
            <DashboardEmpty message={propsCategory ? `No ${categoryLabel[propsCategory]?.toLowerCase()} properties found.` : 'No properties on the platform yet.'} />
          )}
          {!propsLoading && propsData.length > 0 && (
            <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div className="divide-y" style={{ borderColor: 'var(--color-base-100)' }}>
                {propsData.map((p) => {
                  const cc = categoryColor[p.spaceCategory] ?? { bg: 'var(--color-base-100)', color: 'var(--color-neutral-600)' };
                  return (
                    <div key={p.id} className="p-5 flex flex-wrap items-center gap-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: cc.bg }}>
                        <Building2 size={18} style={{ color: cc.color }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{p.buildingName}</p>
                        {p.fullAddress && <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>{p.fullAddress}</p>}
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-400)' }}>
                          RP #{p.rentalProviderId} · {new Date(p.createdAt).toLocaleDateString('en-AE')}
                        </p>
                      </div>
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full shrink-0"
                        style={{ backgroundColor: cc.bg, color: cc.color }}>
                        {categoryLabel[p.spaceCategory] ?? p.spaceCategory}
                      </span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-600)' }}>
                          <Eye size={13} /> {p.listedCount} listed
                        </span>
                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-400)' }}>
                          <EyeOff size={13} /> {p.unitCount - p.listedCount} unlisted
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Pagination page={propsPage} total={propsTotal} pageSize={PAGE_SIZE} onChange={setPropsPage} />
            </div>
          )}
        </div>
      )}

    </div>
  );
}
