'use client';

import Link from 'next/link';
import { Wrench, Sparkles, HeartPulse, ArrowRight, LayoutGrid } from 'lucide-react';

const serviceGroups = [
  {
    title: 'Home & Office',
    subtitle: 'AC, plumbing, electrical, carpentry, appliances',
    cta: 'Book Now',
    overlay: 'linear-gradient(135deg, rgba(160,120,70,0.74) 0%, rgba(100,65,30,0.88) 100%)',
    Icon: Wrench,
    href: '/services?category=home-office-maintenance',
    image: '/assets/services-maintenance.jpg',
  },
  {
    title: 'Cleaning & Hygiene',
    subtitle: 'Home, office, deep cleaning, fabric, sanitization',
    cta: 'Book Now',
    overlay: 'linear-gradient(135deg, rgba(118,136,84,0.72) 0%, rgba(68,82,40,0.86) 100%)',
    Icon: Sparkles,
    href: '/services?category=cleaning-hygiene',
    image: '/assets/services-cleaning.jpg',
  },
  {
    title: 'Lifestyle & Wellness',
    subtitle: 'Grooming, healthcare, pet care, family support',
    cta: 'Book Now',
    overlay: 'linear-gradient(135deg, rgba(176,122,92,0.70) 0%, rgba(118,74,48,0.85) 100%)',
    Icon: HeartPulse,
    href: '/services?category=lifestyle-wellness',
    image: '/assets/services-lifestyle.jpg',
  },
  {
    title: 'View All Services',
    subtitle: 'Browse the full range of services on our platform',
    cta: 'Browse Services',
    overlay: 'linear-gradient(135deg, rgba(86,106,88,0.75) 0%, rgba(52,68,54,0.90) 100%)',
    Icon: LayoutGrid,
    href: '/services',
    image: '/assets/services-all.jpg',
  },
];

export function ServiceCategories() {
  return (
    <section className="section-padding" style={{ backgroundColor: 'var(--base-100)' }}>
      <div className="container">
        <h2 className="font-bold" style={{ fontSize: 42, color: 'var(--neutral-900)', letterSpacing: '-0.02em' }}>
          Browse services
        </h2>
        <p className="mt-2" style={{ color: 'var(--neutral-500)', fontSize: 20 }}>
          Book trusted professionals — instant booking or quote
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {serviceGroups.map((s) => (
            <Link
              href={s.href}
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
