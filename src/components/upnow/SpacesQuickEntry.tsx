'use client';

import Link from 'next/link';
import { Home, Building2, Warehouse, ArrowRight, LayoutGrid } from 'lucide-react';

const spaces = [
  {
    title: 'Residential',
    subtitle: 'Apartments, villas, studios, penthouses, townhouses',
    cta: 'Find Now',
    image: '/assets/spaces-residential.jpg',
    overlay: 'linear-gradient(135deg, rgba(140,110,65,0.72) 0%, rgba(90,65,30,0.85) 100%)',
    Icon: Home,
    categoryParam: 'Residential',
  },
  {
    title: 'Commercial',
    subtitle: 'Offices, coworking, retail units, showrooms, meeting rooms',
    cta: 'Find Now',
    image: '/assets/spaces-commercial.jpg',
    overlay: 'linear-gradient(135deg, rgba(120,94,74,0.68) 0%, rgba(74,56,40,0.82) 100%)',
    Icon: Building2,
    categoryParam: 'Commercial',
  },
  {
    title: 'Industrial',
    subtitle: 'Warehouses, storage, cold storage, industrial units',
    cta: 'Find Now',
    image: '/assets/spaces-workspaces.jpg',
    overlay: 'linear-gradient(135deg, rgba(164,128,86,0.65) 0%, rgba(104,78,42,0.80) 100%)',
    Icon: Warehouse,
    categoryParam: 'Industrial',
  },
  {
    title: 'View All Spaces',
    subtitle: 'Venues, industrial, and every space type available',
    cta: 'Find Spaces',
    image: '/assets/spaces-all.jpg',
    overlay: 'linear-gradient(135deg, rgba(92,108,94,0.75) 0%, rgba(56,70,58,0.90) 100%)',
    Icon: LayoutGrid,
    categoryParam: '',
  },
];

export function SpacesQuickEntry() {
  return (
    <section className="section-padding" style={{ backgroundColor: 'var(--white)' }}>
      <div className="container">
        <h2 className="font-bold" style={{ fontSize: 42, color: 'var(--neutral-900)', letterSpacing: '-0.02em' }}>
          Explore spaces
        </h2>
        <p className="mt-2" style={{ color: 'var(--neutral-500)', fontSize: 20 }}>
          Residential, commercial, industrial, venues and more
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {spaces.map((s) => (
            <Link
              href={s.categoryParam ? `/listings?category=${s.categoryParam.toLowerCase()}` : '/listings'}
              key={s.title}
              className="group relative flex flex-col justify-between overflow-hidden"
              style={{
                height: 320,
                borderRadius: 20,
                boxShadow: '0 4px 20px -4px rgba(0,0,0,0.10)',
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.02)';
                e.currentTarget.style.boxShadow = '0 12px 40px -8px rgba(0,0,0,0.18)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 4px 20px -4px rgba(0,0,0,0.10)';
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.image}
                alt=""
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0" style={{ background: s.overlay }} />
              <div className="relative z-10 flex flex-col justify-between h-full p-8">
                <div
                  style={{
                    width: 44, height: 44, borderRadius: 12,
                    backgroundColor: 'rgba(255,255,255,0.20)',
                    backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <s.Icon size={22} color="white" />
                </div>
                <div>
                  <h3 className="font-bold" style={{ fontSize: 26, color: '#fff', lineHeight: 1.2 }}>{s.title}</h3>
                  <p className="mt-2" style={{ fontSize: 14, color: 'rgba(255,255,255,0.80)' }}>{s.subtitle}</p>
                  <div
                    className="inline-flex items-center gap-2 mt-5"
                    style={{
                      padding: '10px 20px', borderRadius: 9999,
                      backgroundColor: 'rgba(255,255,255,0.20)',
                      backdropFilter: 'blur(8px)',
                      color: '#fff', fontSize: 14, fontWeight: 600,
                    }}
                  >
                    {s.cta}
                    <ArrowRight size={14} />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
