'use client';

import Link from 'next/link';
import { Star, ShieldCheck, MapPin, Home, Search, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type SearchMode = 'properties' | 'services';

const PROPERTY_CATEGORIES = [
  { label: 'All', value: '' },
  { label: 'Residential', value: 'residential' },
  { label: 'Commercial', value: 'commercial' },
  { label: 'Industrial', value: 'industrial' },
  { label: 'Land', value: 'land' },
  { label: 'Mixed-use', value: 'mixed_use' },
];

const BEDROOMS = [
  { label: 'Any', value: '' },
  { label: 'Studio', value: '0' },
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4+', value: '4' },
];

const SERVICE_SUGGESTIONS = [
  'AC Service', 'Plumbing', 'Electrical', 'Painting', 'Cleaning', 'Moving',
];

const trustItems = [
  { Icon: Star,        text: '4.8 average rating' },
  { Icon: ShieldCheck, text: '500+ verified providers' },
  { Icon: MapPin,      text: 'Available across UAE' },
];

export function HeroSection() {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>('properties');
  const [category, setCategory] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [serviceQuery, setServiceQuery] = useState('');

  function handleSearch() {
    if (mode === 'properties') {
      const qs = new URLSearchParams();
      if (category) qs.set('category', category);
      if (bedrooms) qs.set('bedrooms', bedrooms);
      router.push(`/listings${qs.toString() ? `?${qs}` : ''}`);
    } else {
      const qs = new URLSearchParams();
      if (serviceQuery.trim()) qs.set('q', serviceQuery.trim());
      router.push(`/services${qs.toString() ? `?${qs}` : ''}`);
    }
  }

  return (
    <section
      className="relative"
      style={{
        background: 'linear-gradient(180deg, #eef7f2 0%, var(--base-100) 100%)',
        paddingBlock: '96px 80px',
      }}
    >
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left */}
          <div>
            <p
              className="text-xs font-[600] uppercase tracking-[0.15em]"
              style={{ color: 'var(--primary)' }}
            >
              Services &amp; Spaces
            </p>

            <h1
              className="mt-4 font-bold"
              style={{ fontSize: 56, lineHeight: 1.08, color: 'var(--neutral-900)', letterSpacing: '-0.02em' }}
            >
              Everything your home, office, and space needs.
            </h1>

            <p
              className="mt-5 max-w-[480px]"
              style={{ color: 'var(--neutral-500)', lineHeight: 1.7, fontSize: 18 }}
            >
              UpNow — where services and spaces come together.
            </p>

            {/* Search widget */}
            <div
              className="mt-8 w-full max-w-[560px]"
              style={{
                backgroundColor: 'var(--white)',
                borderRadius: 20,
                boxShadow: '0 4px 24px -4px rgba(4,114,70,0.14)',
                padding: '20px 24px',
              }}
            >
              {/* Mode toggle */}
              <div className="flex gap-1 mb-5 p-1 rounded-xl" style={{ backgroundColor: 'var(--base-200)' }}>
                <button
                  onClick={() => setMode('properties')}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all"
                  style={{
                    backgroundColor: mode === 'properties' ? '#fff' : 'transparent',
                    color: mode === 'properties' ? 'var(--primary)' : 'var(--neutral-500)',
                    boxShadow: mode === 'properties' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  <Home size={15} />
                  Properties
                </button>
                <button
                  onClick={() => setMode('services')}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all"
                  style={{
                    backgroundColor: mode === 'services' ? '#fff' : 'transparent',
                    color: mode === 'services' ? 'var(--primary)' : 'var(--neutral-500)',
                    boxShadow: mode === 'services' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  <Wrench size={15} />
                  Services
                </button>
              </div>

              {mode === 'properties' ? (
                <>
                  {/* Category pills */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {PROPERTY_CATEGORIES.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setCategory(c.value)}
                        className="cursor-pointer transition-all text-sm font-medium px-3 py-1.5 rounded-full"
                        style={{
                          backgroundColor: category === c.value ? 'var(--primary)' : 'var(--base-200)',
                          color: category === c.value ? '#fff' : 'var(--neutral-700)',
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {/* Bedrooms row */}
                  <div className="mb-4">
                    <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--neutral-500)' }}>Bedrooms</p>
                    <div className="flex gap-2 flex-wrap">
                      {BEDROOMS.map((b) => (
                        <button
                          key={b.value}
                          onClick={() => setBedrooms(b.value)}
                          className="cursor-pointer transition-all text-sm font-medium px-3 py-1 rounded-lg border"
                          style={{
                            borderColor: bedrooms === b.value ? 'var(--primary)' : 'var(--base-300)',
                            backgroundColor: bedrooms === b.value ? '#e6f7f1' : 'transparent',
                            color: bedrooms === b.value ? 'var(--primary)' : 'var(--neutral-600)',
                          }}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Service text search */}
                  <div className="relative mb-4">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--neutral-400)' }} />
                    <input
                      type="text"
                      value={serviceQuery}
                      onChange={(e) => setServiceQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder="e.g. AC service, plumbing, cleaning..."
                      className="w-full rounded-xl border text-sm pl-9 pr-3 py-2.5 outline-none focus:ring-2"
                      style={{
                        borderColor: 'var(--base-300)',
                        backgroundColor: 'var(--base-100)',
                        color: 'var(--neutral-900)',
                      }}
                    />
                  </div>
                  {/* Quick suggestions */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {SERVICE_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setServiceQuery(s)}
                        className="cursor-pointer transition-all text-xs font-medium px-2.5 py-1 rounded-full"
                        style={{
                          backgroundColor: serviceQuery === s ? 'var(--primary)' : 'var(--base-200)',
                          color: serviceQuery === s ? '#fff' : 'var(--neutral-600)',
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Search button */}
              <button
                onClick={handleSearch}
                className="w-full flex items-center justify-center gap-2 font-semibold text-sm py-3 rounded-xl cursor-pointer transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--primary)', color: '#fff' }}
              >
                <Search size={16} />
                {mode === 'properties' ? 'Search Properties' : 'Find Services'}
              </button>
            </div>

            {/* Secondary CTA */}
            <div className="flex items-center gap-4 mt-5">
              <Link href="/listings">
                <Button variant="secondary" size="md" className="w-auto">Browse all listings</Button>
              </Link>
              <Link href="/services" className="text-sm font-medium" style={{ color: 'var(--primary)' }}>
                Book a service →
              </Link>
            </div>

            {/* Trust indicators */}
            <div className="flex flex-wrap gap-5 mt-10">
              {trustItems.map((t) => (
                <span
                  key={t.text}
                  className="flex items-center gap-2.5 text-sm font-[500] px-4 py-2.5"
                  style={{
                    color: 'var(--neutral-700)',
                    backgroundColor: 'var(--white)',
                    borderRadius: 12,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  }}
                >
                  <div
                    className="flex items-center justify-center"
                    style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'var(--primary-light)' }}
                  >
                    <t.Icon size={16} style={{ color: 'var(--primary)' }} />
                  </div>
                  {t.text}
                </span>
              ))}
            </div>
          </div>

          {/* Right — visual card */}
          <div className="hidden lg:flex items-center justify-center">
            <div
              style={{
                width: '100%',
                maxWidth: 420,
                borderRadius: 24,
                background: 'linear-gradient(160deg, #e6f7f1 0%, #d4f0e7 50%, #c8ebde 100%)',
                padding: '56px 40px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                boxShadow: '0 8px 40px -8px rgba(4,114,70,0.18)',
              }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 80, height: 80, borderRadius: '50%',
                  backgroundColor: 'var(--white)',
                  boxShadow: '0 4px 20px -4px rgba(4,114,70,0.2)',
                  marginBottom: 28,
                }}
              >
                <Home size={36} style={{ color: 'var(--primary)' }} />
              </div>

              <h3
                className="font-bold"
                style={{ fontSize: 24, color: 'var(--neutral-900)', lineHeight: 1.3 }}
              >
                Your space, your way
              </h3>

              <p className="mt-2 text-sm" style={{ color: 'var(--neutral-600)', lineHeight: 1.6 }}>
                Premium lifestyle services
              </p>

              <div className="flex gap-2 mt-8">
                {[0.3, 0.6, 1, 0.6, 0.3].map((op, i) => (
                  <div
                    key={i}
                    style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--primary)', opacity: op }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
