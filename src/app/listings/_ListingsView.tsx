import Link from 'next/link';
import { MapPin, BedDouble, Bath, Maximize2 } from 'lucide-react';
import { Suspense } from 'react';
import FilterBar, { ListingsSearchBar } from './FilterBar';
import type { FilterBarProps } from './FilterBar';
import FilterSidebarWrapper from './FilterSidebarWrapper';
import { Navbar } from '@/components/upnow/Navbar';
import HeartButton from './HeartButton';

const BACKEND = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const BACKEND_HOST = BACKEND.replace(/\/api$/, '');

/* ── Shared location types ───────────────────────────────────── */
export interface CountryItem { id: number; code: string; nameEn: string; }
export interface EmirateItem { id: number; nameEn: string; slug: string; }
export interface LocationOption { label: string; kind: 'community' | 'subCommunity' | 'building' | 'city'; }

/* ── Types ───────────────────────────────────────────────────── */
interface PublicUnit {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  floor: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  unitSizeSqft: string | number | null;
  rentalPrice: string | number | null;
  availability: string;
}
interface PublicProperty {
  id: number;
  buildingName: string;
  fullAddress: string | null;
  spaceCategory: string;
}
interface ListingsResponse {
  items: Array<{ unit: PublicUnit; property: PublicProperty; coverPhotoUrl: string | null }>;
  total: number;
  page: number;
  pageSize: number;
}

/* ── Fallback images ─────────────────────────────────────────── */
const FALLBACK_POOLS: Record<string, string[]> = {
  residential: [
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=640&q=75&auto=format&fit=crop',
  ],
  commercial: [
    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=640&q=75&auto=format&fit=crop',
  ],
  industrial: [
    'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1553413077-190dd305871c?w=640&q=75&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1601598851547-4302969d0614?w=640&q=75&auto=format&fit=crop',
  ],
};

function fallbackImg(cat: string, id: number): string {
  const pool = FALLBACK_POOLS[cat.toLowerCase()] ?? FALLBACK_POOLS.residential;
  return pool[id % pool.length];
}

/* ── Helpers ─────────────────────────────────────────────────── */
function fmtAed(n: string | number | null) {
  if (n == null) return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return `AED ${new Intl.NumberFormat('en-AE').format(num)}`;
}
function humanType(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* ── Props ───────────────────────────────────────────────────── */
export interface ListingsViewSearchParams {
  category?:     string;
  spaceType?:    string;
  bedrooms?:     string;
  bathrooms?:    string;
  furnishing?:   string;
  amenities?:    string;
  availability?: string;
  minPrice?:     string;
  maxPrice?:     string;
  sort?:         string;
  page?:         string;
  q?:            string;
  view?:         string;
}

interface Props {
  country:      string;
  emirate:      string;
  searchParams: ListingsViewSearchParams;
}

/* ── View ────────────────────────────────────────────────────── */
export default async function ListingsView({ country, emirate, searchParams }: Props) {
  const sp = searchParams;
  const category     = sp.category     ?? '';
  const spaceType    = sp.spaceType    ?? '';
  const bedrooms     = sp.bedrooms     ?? '';
  const bathrooms    = sp.bathrooms    ?? '';
  const furnishing   = sp.furnishing   ?? '';
  const amenities    = sp.amenities    ?? '';
  const availability = sp.availability ?? '';
  const minPrice     = sp.minPrice     ?? '';
  const maxPrice     = sp.maxPrice     ?? '';
  const sort         = sp.sort         ?? 'newest';
  const q            = sp.q            ?? '';
  const view         = sp.view         ?? 'grid';
  const page         = parseInt(sp.page ?? '1', 10);

  /* Fetch locations + listings in parallel */
  const [countriesList, emiratesList, locationOptions, listingsData] = await Promise.all([
    fetch(`${BACKEND}/locations/countries`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : []).catch(() => []) as Promise<CountryItem[]>,
    fetch(`${BACKEND}/locations/emirates`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : []).catch(() => []) as Promise<EmirateItem[]>,
    (async () => {
      const lq = new URLSearchParams({
        ...(category && { category }),
        ...(country  && { country }),
        ...(emirate  && { emirate }),
      });
      try {
        const res = await fetch(`${BACKEND}/listings/locations?${lq}`, { cache: 'no-store' });
        if (res.ok) return await res.json() as LocationOption[];
      } catch { /* fall back to empty pick-list */ }
      return [] as LocationOption[];
    })(),
    (async () => {
      const qs = new URLSearchParams({
        page: String(page), limit: '24', sort,
        ...(category  && { category }),
        ...(spaceType && { spaceType }),
        ...(bedrooms  && { bedrooms }),
        ...(bathrooms && { bathrooms }),
        ...(minPrice  && { minPrice }),
        ...(maxPrice  && { maxPrice }),
        ...(q         && { q }),
        ...(country   && { country }),
        ...(emirate   && { emirate }),
      });
      try {
        const res = await fetch(`${BACKEND}/listings/units?${qs}`, { cache: 'no-store' });
        if (res.ok) return await res.json() as ListingsResponse;
      } catch { /* show empty state */ }
      return { items: [], total: 0, page: 1, pageSize: 24 } as ListingsResponse;
    })(),
  ]);

  const data       = listingsData;
  const totalPages = Math.ceil(data.total / data.pageSize);

  /* Base path */
  let basePath = '/listings';
  if (country) basePath += `/${country}`;
  if (country && emirate) basePath += `/${emirate}`;

  function pageUrl(p: number) {
    const next = new URLSearchParams(sp as Record<string, string>);
    next.set('page', String(p));
    next.delete('country');
    next.delete('emirate');
    return `${basePath}?${next}`;
  }

  /* Display names */
  const countryName = countriesList.find(c => c.code.toLowerCase() === country)?.nameEn ?? '';
  const emirateName = emiratesList.find(e => e.slug === emirate)?.nameEn ?? '';

  /* Subtitle */
  let subtitle = 'Residential, commercial, workspaces and venues — across the UAE.';
  if (emirate && countryName)      subtitle = `Residential, commercial and more in ${emirateName}, ${countryName}`;
  else if (country && countryName) subtitle = `Residential, commercial and more across ${countryName}`;

  /* Page title */
  const pageTitle = emirate && emirateName
    ? `Find Your Space in ${emirateName}`
    : country && countryName
      ? `Find Your Space in ${countryName}`
      : 'Find Your Space';

  /* Breadcrumbs */
  const crumbs: { label: string; href?: string }[] = [
    { label: 'Home', href: '/' },
    { label: 'Spaces', href: '/listings' },
  ];
  if (country && countryName) crumbs.push({ label: countryName, href: `/listings/${country}` });
  if (emirate && emirateName)  crumbs.push({ label: emirateName, href: `/listings/${country}/${emirate}` });
  crumbs.push({ label: pageTitle });

  /* Shared props for filter components */
  const filterProps: FilterBarProps = {
    category, spaceType, bedrooms, bathrooms, furnishing, amenities, availability,
    minPrice, maxPrice, sort, view, q,
    emirate, country, emirateName, countryName,
    countriesList, emiratesList,
    total: data.total,
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      <Navbar />

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="lst-hero">
        <div className="l-wrap">
          {/* Breadcrumb */}
          <nav className="crumb">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span className="sep">/</span>}
                {c.href && i < crumbs.length - 1
                  ? <Link href={c.href}>{c.label}</Link>
                  : <span className="here">{c.label}</span>
                }
              </span>
            ))}
          </nav>

          {/* Heading */}
          <div className="lst-head">
            <h1>{pageTitle}</h1>
          </div>

          {/* Search bar */}
          <Suspense>
            <ListingsSearchBar
              defaultQ={q}
              country={country}
              emirate={emirate}
              emiratesList={emiratesList}
              locationOptions={locationOptions}
            />
          </Suspense>
        </div>
      </section>

      {/* ── Body ─────────────────────────────────────────── */}
      <section className="lst-body">
        <div className="l-wrap">
          {/* Emirate strip + results bar + active pills + mobile drawer */}
          <Suspense>
            <FilterBar {...filterProps} />
          </Suspense>

          {/* Two-column layout */}
          <div className="lst-cols">
            {/* Desktop sidebar */}
            <aside className="lst-aside">
              <FilterSidebarWrapper {...filterProps} />
            </aside>

            {/* Results */}
            <div className="lst-main">
              {data.items.length === 0 ? (
                <div className="lst-empty">
                  <div className="ei">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/>
                    </svg>
                  </div>
                  <h3>No spaces match your filters</h3>
                  <p>Try widening your search or clearing a filter.</p>
                  <Link href={basePath} className="l-gcard btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 999, background: '#2e9f82', color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', marginTop: 4 }}>
                    Reset filters
                  </Link>
                </div>
              ) : (
                <div className={`lst-results${view === 'list' ? ' list' : ''}`}>
                  {data.items.map(({ unit, property, coverPhotoUrl }) => {
                    const catKey  = property.spaceCategory.toLowerCase();
                    // unit_media.url is stored ABSOLUTE in every storage mode —
                    // only prefix genuinely relative paths.
                    const cardImg = coverPhotoUrl
                      ? (coverPhotoUrl.startsWith('http') || coverPhotoUrl.startsWith('/')
                          ? coverPhotoUrl
                          : `${BACKEND_HOST}/uploads/${coverPhotoUrl}`)
                      : fallbackImg(catKey, unit.id);
                    const label   = unit.unitName ?? `Unit ${unit.unitNumber}`;
                    const price   = fmtAed(unit.rentalPrice);

                    return (
                      <Link key={unit.id} href={`/listings/units/${unit.id}`} className="lcard">
                        {/* Photo */}
                        <div className="ph">
                          <img src={cardImg} alt={label} loading="lazy" />
                          <span className="cbadge">{humanType(unit.unitType)}</span>
                          <HeartButton />
                          {unit.availability === 'available' && (
                            <span className="feat-tag">
                              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/>
                              </svg>
                              Available Now
                            </span>
                          )}
                        </div>

                        {/* Body */}
                        <div className="body">
                          <div className="r1">
                            <div className="ttl">{label}</div>
                          </div>
                          <div className="loc">
                            <MapPin size={12} />
                            <span>
                              {property.buildingName}
                              {property.fullAddress ? ` · ${property.fullAddress}` : ''}
                            </span>
                          </div>

                          {/* Meta row */}
                          <div className="meta">
                            {unit.bedrooms != null && (
                              <span>
                                <BedDouble size={13} />
                                {unit.bedrooms === 0 ? 'Studio' : `${unit.bedrooms} Bed`}
                              </span>
                            )}
                            {unit.bathrooms != null && (
                              <span>
                                <Bath size={13} />
                                {unit.bathrooms} Bath
                              </span>
                            )}
                            {unit.unitSizeSqft != null && (
                              <span>
                                <Maximize2 size={13} />
                                {Number(unit.unitSizeSqft).toLocaleString()} sqft
                              </span>
                            )}
                          </div>

                          {/* Type chip */}
                          <div className="amens">
                            <span className="amchip">{humanType(unit.unitType)}</span>
                          </div>

                          {/* Price */}
                          <div className="price">
                            <div className="amt">
                              {price ?? 'Price on request'}
                              {price && <small>/yr</small>}
                            </div>
                            <div className="ut">{humanType(catKey)}</div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pager">
                  {page > 1 ? (
                    <Link href={pageUrl(page - 1)} className="pager-btn">
                      ← Prev
                    </Link>
                  ) : (
                    <button className="pager-btn" disabled>← Prev</button>
                  )}

                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const p = i + 1;
                    return (
                      <Link
                        key={p}
                        href={pageUrl(p)}
                        className={`pager-btn${p === page ? ' on' : ''}`}
                      >
                        {p}
                      </Link>
                    );
                  })}

                  {page < totalPages ? (
                    <Link href={pageUrl(page + 1)} className="pager-btn">
                      Next →
                    </Link>
                  ) : (
                    <button className="pager-btn" disabled>Next →</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
