'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  X,
  Loader2,
  ImageIcon,
  Layers,
  FileText,
  History,
  Banknote,
  Users,
  ExternalLink,
} from 'lucide-react';
import { apiGet } from '@/lib/api';

/* ---------- types ---------- */

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
  listingStatus: string;
  planLabel?: string | null;
  floorPlanUrl?: string | null;
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
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f0faf6] text-[#2e9f82]">
        {icon}
      </span>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6b6860]">{children}</h3>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-[#e8e6e0] p-4">{children}</div>;
}

/* ---------- component ---------- */

export function UnitPreviewModal({
  propertyId,
  fetchBase = '/properties',
  fetchQuery = '',
  propertyName,
  unit,
  contract,
  onClose,
}: {
  propertyId: number;
  /** Manager portal passes '/manager/properties' + 'rp=N'. */
  fetchBase?: string;
  fetchQuery?: string;
  propertyName?: string | null;
  unit: Unit;
  contract?: { id: number; tenantName: string | null; endDate: string | null; status: string } | null;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<UnitMedia[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Unit-owned documents (per-unit title deed for multi-unit buildings).
  const [unitDocs, setUnitDocs] = useState<Array<{ id: number; documentKey?: string; document_key?: string; displayName?: string | null; fileUrl?: string; file_url?: string; url?: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    setMediaLoading(true);
    setHistoryLoading(true);
    apiGet<UnitMedia[]>(`${fetchBase}/${propertyId}/units/${unit.id}/media${fetchQuery ? `?${fetchQuery}` : ''}`)
      .then((m) => {
        if (!cancelled) setMedia(m || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMediaLoading(false);
      });
    apiGet<PriceHistory>(`${fetchBase}/${propertyId}/units/${unit.id}/price-history${fetchQuery ? `?${fetchQuery}` : ''}`)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    apiGet<typeof unitDocs>(`/documents?ownerType=unit&ownerId=${unit.id}`)
      .then((d) => { if (!cancelled) setUnitDocs(Array.isArray(d) ? d : []); })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [propertyId, unit.id, fetchBase, fetchQuery]);

  /* ---------- derived ---------- */

  const unitTitle = unit.unitName || `Unit ${unit.unitNumber ?? unit.id}`;

  const rent = unit.rentalPrice;
  const market = unit.marketPrice;
  const gap = rent != null && market != null && rent > 0 ? market - rent : null;
  const gapPct = gap !== null && rent ? (gap / rent) * 100 : null;

  const details: Array<[string, string | null]> = [
    ['Type', unit.unitType ? titleCase(unit.unitType) : null],
    ['Tier', unit.unitTier ? titleCase(unit.unitTier) : null],
    ['Plan', unit.planLabel ?? null],
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
  ];
  const visibleDetails = details.filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== '',
  );

  const pricingRows: Array<[string, string | null]> = [
    ['Market benchmark', aed(market)],
    ['Security deposit', aed(unit.securityDeposit)],
    ['Admin fee', aed(unit.adminFee)],
    // ejariFeeFils is actually whole AED despite the column name.
    ['Ejari fee', aed(unit.ejariFeeFils)],
    ['Commission', aed(unit.commission)],
    ['Service charges', aed(unit.serviceCharges)],
  ];
  const visiblePricing = pricingRows.filter(([, v]) => v !== null);

  const timeline = history?.timeline ?? [];

  const subline = [
    propertyName,
    unit.floor ? `Floor ${unit.floor}` : null,
    unit.premiseNumber ? `Premise ${unit.premiseNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const isPublished = unit.isListed || (unit.listingStatus || '').toLowerCase() === 'published';

  /* ---------- render ---------- */

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#e8e6e0] px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg font-bold text-[#1a1916]">{unitTitle}</h2>
              {unit.availability && (
                <Chip tone={availabilityTone(unit.availability)}>{titleCase(unit.availability)}</Chip>
              )}
              {unit.listingStatus && (
                <Chip tone={listingTone(unit.listingStatus)}>{titleCase(unit.listingStatus)}</Chip>
              )}
              {unit.unitType && <Chip tone="gray">{titleCase(unit.unitType)}</Chip>}
            </div>
            {subline && <p className="mt-1 text-sm text-[#6b6860]">{subline}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#6b6860] hover:bg-[#f4f3ef]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 overflow-auto p-6">
          {/* 2. Photos */}
          <Card>
            <SectionTitle icon={<ImageIcon className="h-4 w-4" />}>Photos</SectionTitle>
            {mediaLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-[#2e9f82]" />
              </div>
            ) : media.length === 0 ? (
              <p className="py-4 text-center text-sm text-[#9b9890]">No photos yet</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {media.map((m) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={m.id}
                    src={m.url}
                    alt={m.caption || unitTitle}
                    className="h-32 w-full rounded-xl border border-[#e8e6e0] object-cover"
                  />
                ))}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* 3. Details */}
            <Card>
              <SectionTitle icon={<Layers className="h-4 w-4" />}>Details</SectionTitle>
              {visibleDetails.length === 0 ? (
                <p className="py-3 text-center text-sm text-[#9b9890]">No details recorded</p>
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {visibleDetails.map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-baseline justify-between gap-3 border-b border-[#f4f3ef] pb-1.5"
                    >
                      <dt className="text-xs font-medium uppercase tracking-wide text-[#9b9890]">
                        {label}
                      </dt>
                      <dd className="text-right text-sm font-medium text-[#1a1916]">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {unit.description && (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[#6b6860]">
                  {unit.description}
                </p>
              )}
            </Card>

            <div className="space-y-5">
              {/* 4. Pricing */}
              <Card>
                <SectionTitle icon={<Banknote className="h-4 w-4" />}>Pricing</SectionTitle>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[#9b9890]">
                    Annual rent
                  </p>
                  <p className="mt-0.5 text-2xl font-bold text-[#1a1916]">
                    {rent != null ? `AED ${Number(rent).toLocaleString('en-AE')}` : '—'}
                  </p>
                </div>
                {(visiblePricing.length > 0 || gap !== null) && (
                  <div className="mt-3 space-y-2">
                    {visiblePricing.map(([label, value]) => (
                      <div key={label} className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-[#6b6860]">{label}</span>
                        <span className="text-sm font-medium text-[#1a1916]">{value}</span>
                      </div>
                    ))}
                    {gap !== null && gapPct !== null && (
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-[#6b6860]">Gap vs market</span>
                        <span
                          className={`text-sm font-semibold ${
                            gap > 0 ? 'text-[#166534]' : gap < 0 ? 'text-[#854d0e]' : 'text-[#6b6860]'
                          }`}
                        >
                          {gap > 0
                            ? `+AED ${gap.toLocaleString('en-AE')} uplift (${gapPct.toFixed(1)}%)`
                            : gap < 0
                              ? `AED ${Math.abs(gap).toLocaleString('en-AE')} above market (${Math.abs(gapPct).toFixed(1)}%)`
                              : 'At market'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {/* 7. Tenancy */}
              <Card>
                <SectionTitle icon={<Users className="h-4 w-4" />}>Current Tenancy</SectionTitle>
                {contract ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-[#1a1916]">
                        {contract.tenantName || 'Tenant'}
                      </span>
                      <Chip tone={contractTone(contract.status)}>{titleCase(contract.status)}</Chip>
                    </div>
                    {contract.endDate && (
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-[#6b6860]">Lease ends</span>
                        <span className="text-sm font-medium text-[#1a1916]">
                          {fmtDate(contract.endDate)}
                        </span>
                      </div>
                    )}
                    <Link
                      href={`/rental-provider/dashboard/contracts/${contract.id}/v2`}
                      className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-[#2e9f82] hover:underline"
                    >
                      Open contract
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                ) : (
                  <p className="py-2 text-center text-sm text-[#9b9890]">Vacant — no running lease</p>
                )}
              </Card>
            </div>
          </div>

          {/* 4b. Unit documents — the per-unit title deed lives here */}
          {unitDocs.length > 0 && (
            <Card>
              <SectionTitle icon={<FileText className="h-4 w-4" />}>Documents</SectionTitle>
              <div className="space-y-1.5">
                {unitDocs.map(d => {
                  const key = d.documentKey ?? d.document_key ?? '';
                  const url = d.fileUrl ?? d.file_url ?? d.url;
                  const label = d.displayName || (key === 'title_deed' ? 'Title deed' : key.replace(/_/g, ' '));
                  return (
                    <div key={d.id} className="flex items-center gap-2 text-sm">
                      <FileText className="h-3.5 w-3.5 text-[#2e9f82] shrink-0" />
                      <span className="text-[#1a1916] flex-1 truncate capitalize">{label}</span>
                      {url && (
                        <a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#2e9f82] hover:underline">Open</a>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* 5. Floor plan */}
          {unit.floorPlanUrl && (
            <Card>
              <SectionTitle icon={<FileText className="h-4 w-4" />}>Floor Plan</SectionTitle>
              <iframe
                src={unit.floorPlanUrl}
                title={`${unitTitle} floor plan`}
                className="h-72 w-full rounded-xl border border-[#e8e6e0]"
              />
              <a
                href={unit.floorPlanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium text-[#2e9f82] hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open full size
              </a>
            </Card>
          )}

          {/* 6. Price history */}
          <Card>
            <SectionTitle icon={<History className="h-4 w-4" />}>Price History</SectionTitle>
            {historyLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-[#2e9f82]" />
              </div>
            ) : timeline.length === 0 ? (
              <p className="py-4 text-center text-sm text-[#9b9890]">
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
                            <td className="whitespace-nowrap py-2 pr-4 text-[#1a1916]">
                              {fmtDate(ev.date)}
                            </td>
                            <td className="py-2 pr-4 text-[#6b6860]">
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
                            <td className="whitespace-nowrap py-2 pr-4 text-right font-medium text-[#1a1916]">
                              {aed(ev.annualRent) ?? '—'}
                            </td>
                            <td className="whitespace-nowrap py-2 text-right text-[#6b6860]">
                              {ev.discountAmount
                                ? `−${Number(ev.discountAmount).toLocaleString('en-AE')} discount`
                                : '—'}
                            </td>
                          </tr>
                        );
                      }
                      const delta =
                        ev.newPrice != null && ev.oldPrice != null ? ev.newPrice - ev.oldPrice : null;
                      return (
                        <tr key={`reprice-${i}`} className="border-b border-[#f4f3ef]">
                          <td className="whitespace-nowrap py-2 pr-4 text-[#1a1916]">
                            {fmtDate(ev.date)}
                          </td>
                          <td className="py-2 pr-4 text-[#6b6860]">
                            <span className="font-medium text-[#1a1916]">Repriced</span>
                            {ev.field ? ` · ${titleCase(ev.field)}` : ''}
                            {ev.reason ? ` · ${ev.reason}` : ''}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-right font-medium text-[#1a1916]">
                            {aed(ev.newPrice) ?? '—'}
                          </td>
                          <td
                            className={`whitespace-nowrap py-2 text-right font-medium ${
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

        {/* 8. Footer */}
        <div className="flex items-center justify-end gap-4 border-t border-[#e8e6e0] px-6 py-3.5">
          {isPublished && (
            <Link
              href={`/listings/units/${unit.id}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6b6860] hover:text-[#2e9f82]"
            >
              Public listing
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
          <Link
            href={`/rental-provider/dashboard/portfolio/${propertyId}/units/${unit.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2e9f82] px-4 py-2 text-sm font-semibold text-white hover:bg-[#27876f]"
          >
            Open full page
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
