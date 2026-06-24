import Link from 'next/link';
import { BedDouble, Bath, Maximize2, ArrowRight } from 'lucide-react';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';

const BACKEND = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface PublicUnit {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
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
interface ListingItem {
  unit: PublicUnit;
  property: PublicProperty;
}

const APT_POOL = [
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=600&q=80&auto=format&fit=crop',
];
const CAT_IMAGES: Record<string, string> = {
  commercial: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&q=80&auto=format&fit=crop',
  industrial: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=600&q=80&auto=format&fit=crop',
};

function getImage(unit: PublicUnit, property: PublicProperty) {
  const cat = property.spaceCategory.toLowerCase();
  return CAT_IMAGES[cat] ?? APT_POOL[unit.id % APT_POOL.length];
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

export async function FeaturedListings() {
  let items: ListingItem[] = [];
  try {
    const res = await fetch(`${BACKEND}/listings/units?limit=6&sort=newest`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      items = Array.isArray(data.items) ? data.items : [];
    }
  } catch {
    // silently skip — no listings shown if backend unavailable
  }

  if (items.length === 0) return null;

  return (
    <section className="section-padding" style={{ backgroundColor: 'var(--base-100)' }}>
      <div className="container">
        {/* Header */}
        <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div>
            <h2
              className="font-bold"
              style={{ fontSize: 36, color: 'var(--neutral-900)', letterSpacing: '-0.02em' }}
            >
              Available now
            </h2>
            <p className="mt-1.5 text-base" style={{ color: 'var(--neutral-500)' }}>
              Verified listings ready to book a viewing
            </p>
          </div>
          <Link
            href="/listings"
            className="flex items-center gap-1.5 text-sm font-semibold"
            style={{ color: 'var(--primary)' }}
          >
            View all listings <ArrowRight size={15} />
          </Link>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map(({ unit, property }) => {
            const price = fmtAed(unit.rentalPrice);
            const label = unit.unitName ?? `Unit ${unit.unitNumber}`;
            const img = getImage(unit, property);

            return (
              <Link
                key={unit.id}
                href={`/listings/units/${unit.id}`}
                className="group flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                style={{
                  backgroundColor: 'var(--white)',
                  borderRadius: 20,
                  boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)',
                }}
              >
                {/* Image */}
                <div className="relative overflow-hidden" style={{ height: 200 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img}
                    alt={label}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  {/* Category pill */}
                  <span
                    className="absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: 'var(--neutral-700)' }}
                  >
                    {humanType(property.spaceCategory)}
                  </span>
                  {/* Availability badge */}
                  <span
                    className="absolute top-3 right-3 text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{
                      backgroundColor: unit.availability === 'available' ? '#d8f2e8' : '#fef3c7',
                      color: unit.availability === 'available' ? '#1a7a5a' : '#92400e',
                    }}
                  >
                    {unit.availability === 'available' ? 'Available' : humanType(unit.availability)}
                  </span>
                </div>

                {/* Body */}
                <div className="flex flex-col flex-1 p-5">
                  <p className="text-xs font-medium mb-0.5 truncate" style={{ color: 'var(--neutral-500)' }}>
                    {property.fullAddress ?? property.buildingName}
                  </p>
                  <h3
                    className="font-semibold text-base truncate"
                    style={{ color: 'var(--neutral-900)' }}
                  >
                    {label}
                  </h3>
                  <p className="text-xs mt-0.5 capitalize" style={{ color: 'var(--neutral-500)' }}>
                    {humanType(unit.unitType)}
                  </p>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: 'var(--neutral-600)' }}>
                    {isResidentialUnitType(unit.unitType) && unit.bedrooms != null && (
                      <span className="flex items-center gap-1">
                        <BedDouble size={13} />
                        {unit.bedrooms === 0 ? 'Studio' : `${unit.bedrooms} BR`}
                      </span>
                    )}
                    {isResidentialUnitType(unit.unitType) && unit.bathrooms != null && (
                      <span className="flex items-center gap-1">
                        <Bath size={13} />
                        {unit.bathrooms} Bath
                      </span>
                    )}
                    {unit.unitSizeSqft != null && (
                      <span className="flex items-center gap-1">
                        <Maximize2 size={13} />
                        {Number(unit.unitSizeSqft).toLocaleString()} sqft
                      </span>
                    )}
                  </div>

                  {/* Price + CTA */}
                  <div className="flex items-center justify-between mt-auto pt-4">
                    {price ? (
                      <div>
                        <span className="font-bold text-lg" style={{ color: 'var(--primary)' }}>{price}</span>
                        <span className="text-xs ml-1" style={{ color: 'var(--neutral-500)' }}>/yr</span>
                      </div>
                    ) : (
                      <span className="text-sm font-medium" style={{ color: 'var(--neutral-400)' }}>Price on request</span>
                    )}
                    <span
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                      style={{ backgroundColor: '#e6f7f1', color: 'var(--primary)' }}
                    >
                      Book viewing →
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
