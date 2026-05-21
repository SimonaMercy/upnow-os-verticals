import Link from 'next/link';
import { MapPin, BedDouble, Bath, Maximize2 } from 'lucide-react';
import FilterBar from './FilterBar';
import FilterSidebarWrapper from './FilterSidebarWrapper';

const BACKEND = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/* ── Shared location types (matches backend response shape) ─────────────── */
export interface CountryItem { id: number; code: string; nameEn: string; }
export interface EmirateItem { id: number; nameEn: string; slug: string; }

/* ── Types ─────────────────────────────────────────────────────────────── */
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
  items: Array<{ unit: PublicUnit; property: PublicProperty }>;
  total: number;
  page: number;
  pageSize: number;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
const CATEGORY_BG: Record<string, string> = {
  residential: '#d8f2e8', commercial: '#dbeafe',
  industrial: '#fef3c7',
};
const CATEGORY_IMAGES: Record<string, string> = {
  residential: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=600&q=80&auto=format&fit=crop',
  commercial: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&q=80&auto=format&fit=crop',
  industrial: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=600&q=80&auto=format&fit=crop',
};
const APT_POOL = [
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=600&q=80&auto=format&fit=crop',
];

function getCardImage(unit: PublicUnit, property: PublicProperty) {
  const cat = property.spaceCategory.toLowerCase();
  if (cat !== 'residential') return CATEGORY_IMAGES[cat] ?? APT_POOL[0];
  return APT_POOL[unit.id % APT_POOL.length];
}

function fmtAed(n: string | number | null) {
  if (n == null) return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return `AED ${new Intl.NumberFormat('en-AE').format(num)}`;
}
function humanType(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Props ──────────────────────────────────────────────────────────────── */
export interface ListingsViewSearchParams {
  category?: string;
  spaceType?: string;
  bedrooms?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
  q?: string;
}

interface Props {
  /** Lowercase ISO country code from URL path — '' means no country filter */
  country: string;
  /** Emirate slug from URL path — '' means no emirate filter */
  emirate: string;
  searchParams: ListingsViewSearchParams;
}

/* ── View ───────────────────────────────────────────────────────────────── */
export default async function ListingsView({ country, emirate, searchParams }: Props) {
  const sp = searchParams;
  const category  = sp.category  ?? '';
  const spaceType = sp.spaceType ?? '';
  const bedrooms  = sp.bedrooms  ?? '';
  const minPrice  = sp.minPrice  ?? '';
  const maxPrice  = sp.maxPrice  ?? '';
  const sort      = sp.sort      ?? 'newest';
  const q         = sp.q         ?? '';
  const page      = parseInt(sp.page ?? '1', 10);

  /* Fetch location lists + listings in parallel — fully dynamic, no hardcoded maps */
  const [countriesList, emiratesList, listingsData] = await Promise.all([
    fetch(`${BACKEND}/locations/countries`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : []).catch(() => []) as Promise<CountryItem[]>,
    fetch(`${BACKEND}/locations/emirates`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : []).catch(() => []) as Promise<EmirateItem[]>,
    (async () => {
      const qs = new URLSearchParams({
        page: String(page), limit: '24', sort,
        ...(category  && { category }),
        ...(spaceType && { spaceType }),
        ...(bedrooms  && { bedrooms }),
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

  const data = listingsData;

  const totalPages = Math.ceil(data.total / data.pageSize);

  /* Build the base path for this route (preserves country/emirate in path) */
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

  /* Display names — resolved from API data, not hardcoded */
  const countryName = countriesList.find(c => c.code.toLowerCase() === country)?.nameEn ?? '';
  const emirateName = emiratesList.find(e => e.slug === emirate)?.nameEn ?? '';

  /* Dynamic subtitle */
  let subtitle = 'Residential, commercial, workspaces, venues and more across the GCC';
  if (emirate && countryName) {
    subtitle = `Residential, commercial and more in ${emirateName}, ${countryName}`;
  } else if (country && countryName) {
    subtitle = `Residential, commercial and more across ${countryName}`;
  }

  /* Breadcrumb — shows country and emirate if set */
  const breadcrumbs: { label: string; href?: string }[] = [
    { label: 'Home', href: '/' },
    { label: 'Spaces', href: '/listings' },
  ];
  if (country && countryName) {
    breadcrumbs.push({ label: countryName, href: `/listings/${country}` });
  }
  if (emirate && emirateName) {
    breadcrumbs.push({ label: emirateName });
  }

  return (
    <div className="min-h-screen bg-white">
      {/* ── Navbar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#e8e6e0]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between">
          <Link href="/listings" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl text-sm font-extrabold text-white" style={{ backgroundColor: '#2e9f82' }}>U</span>
            <span className="font-extrabold text-lg text-[#1a1916] tracking-tight">UpNow</span>
          </Link>
          <div className="hidden sm:flex items-center gap-4 text-sm text-[#6b6860]">
            <Link href="/login" className="hover:text-[#1a1916] transition-colors">Sign In</Link>
            <Link href="/register" className="py-2 px-4 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: '#2e9f82' }}>
              Register
            </Link>
          </div>
        </div>
      </header>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <section style={{ backgroundColor: '#f9f8f6', paddingBlock: 40 }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10">
          <nav className="text-sm mb-2" style={{ color: '#9b9890' }}>
            {breadcrumbs.map((crumb, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1">/</span>}
                {crumb.href && i < breadcrumbs.length - 1 ? (
                  <Link href={crumb.href} className="hover:underline">{crumb.label}</Link>
                ) : (
                  <span style={{ color: '#3d3b35' }}>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
          <h1 className="font-extrabold text-[2.5rem] leading-tight" style={{ color: '#1a1916', letterSpacing: '-0.02em' }}>
            {emirate && emirateName
              ? `Find Your Space in ${emirateName}`
              : country && countryName
                ? `Find Your Space in ${countryName}`
                : 'Find Your Space'}
          </h1>
          <p className="mt-2 text-lg" style={{ color: '#6b6860' }}>{subtitle}</p>
        </div>
      </section>

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
        {/* ── Top bar ──────────────────────────────────────────────────── */}
        <FilterBar
          category={category}
          spaceType={spaceType}
          bedrooms={bedrooms}
          minPrice={minPrice}
          maxPrice={maxPrice}
          sort={sort}
          q={q}
          emirate={emirate}
          country={country}
          emirateName={emirateName}
          countryName={countryName}
          countriesList={countriesList}
          emiratesList={emiratesList}
          total={data.total}
        />

        {/* ── Two-column layout ─────────────────────────────────────────── */}
        <div className="flex gap-8 items-start">

          {/* ── Desktop sidebar ─────────────────────────────────────────── */}
          <aside
            className="hidden md:block flex-shrink-0 self-start"
            style={{
              width: 272,
              position: 'sticky',
              top: 76,
              backgroundColor: '#fff',
              borderRadius: 16,
              padding: 24,
              boxShadow: '0 1px 4px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.04)',
            }}
          >
            <FilterSidebarWrapper
              category={category}
              spaceType={spaceType}
              bedrooms={bedrooms}
              minPrice={minPrice}
              maxPrice={maxPrice}
              sort={sort}
              q={q}
              emirate={emirate}
              country={country}
              emirateName={emirateName}
              countryName={countryName}
              countriesList={countriesList}
              emiratesList={emiratesList}
              total={data.total}
            />
          </aside>

          {/* ── Results ─────────────────────────────────────────────────── */}
          <div className="flex-grow min-w-0">
            {data.items.length === 0 ? (
              <div className="py-24 text-center" style={{ color: '#9b9890' }}>
                <p className="text-5xl mb-4">🏠</p>
                <p className="font-semibold text-xl mb-2" style={{ color: '#3d3b35' }}>No listings found</p>
                <p className="text-sm">Try adjusting your filters.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {data.items.map(({ unit, property }) => {
                  const catKey = property.spaceCategory.toLowerCase();
                  const catBg = CATEGORY_BG[catKey] ?? '#f4f3ef';
                  const cardImg = getCardImage(unit, property);
                  const label = unit.unitName ?? `Unit ${unit.unitNumber}`;
                  return (
                    <Link
                      key={unit.id}
                      href={`/listings/units/${unit.id}`}
                      className="group block bg-white rounded-2xl overflow-hidden border border-[#e8e6e0] hover:shadow-lg transition-shadow"
                    >
                      <div className="relative overflow-hidden" style={{ height: 200 }}>
                        <img
                          src={cardImg}
                          alt={label}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        />
                        <div className="absolute top-3 left-3">
                          <span className="text-xs font-medium rounded-full px-2.5 py-1" style={{ backgroundColor: catBg, color: '#1a1916' }}>
                            {humanType(catKey)}
                          </span>
                        </div>
                      </div>
                      <div className="p-4">
                        <p className="font-semibold text-sm truncate" style={{ color: '#1a1916' }}>{label}</p>
                        <p className="text-xs mt-0.5 truncate" style={{ color: '#9b9890' }}>
                          {property.buildingName}
                          {property.fullAddress ? ` · ${property.fullAddress}` : ''}
                        </p>
                        <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: '#6b6860' }}>
                          {unit.bedrooms != null && (
                            <span className="flex items-center gap-1">
                              <BedDouble size={13} />
                              {unit.bedrooms === 0 ? 'Studio' : `${unit.bedrooms} Bed`}
                            </span>
                          )}
                          {unit.bathrooms != null && (
                            <span className="flex items-center gap-1">
                              <Bath size={13} />
                              {unit.bathrooms}
                            </span>
                          )}
                          {unit.unitSizeSqft != null && (
                            <span className="flex items-center gap-1">
                              <Maximize2 size={13} />
                              {Number(unit.unitSizeSqft).toLocaleString()} sqft
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="font-bold text-base" style={{ color: '#2e9f82' }}>
                            {fmtAed(unit.rentalPrice) ?? 'Price on request'}
                            {unit.rentalPrice != null && <span className="font-normal text-xs ml-1" style={{ color: '#9b9890' }}>/yr</span>}
                          </span>
                          <span className="text-xs" style={{ color: '#9b9890' }}>
                            {humanType(unit.unitType)}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* ── Pagination ───────────────────────────────────────────── */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-10 flex-wrap">
                {page > 1 && (
                  <Link href={pageUrl(page - 1)} className="px-4 py-2 rounded-xl text-sm border border-[#e8e6e0] hover:bg-[#f4f3ef] transition-colors" style={{ color: '#3d3b35' }}>
                    ← Prev
                  </Link>
                )}
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const p = i + 1;
                  return (
                    <Link
                      key={p}
                      href={pageUrl(p)}
                      className="w-9 h-9 flex items-center justify-center rounded-xl text-sm font-medium transition-colors"
                      style={{ backgroundColor: p === page ? '#2e9f82' : '#f4f3ef', color: p === page ? '#fff' : '#3d3b35' }}
                    >
                      {p}
                    </Link>
                  );
                })}
                {page < totalPages && (
                  <Link href={pageUrl(page + 1)} className="px-4 py-2 rounded-xl text-sm border border-[#e8e6e0] hover:bg-[#f4f3ef] transition-colors" style={{ color: '#3d3b35' }}>
                    Next →
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
