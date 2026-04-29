'use client';

import Link from 'next/link';
import { Star, ShieldCheck, MapPin, Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';

const trustItems = [
  { Icon: Star,        text: '4.8 average rating' },
  { Icon: ShieldCheck, text: '500+ verified providers' },
  { Icon: MapPin,      text: 'Available across UAE' },
];

export function HeroSection() {
  return (
    <section
      className="relative"
      style={{
        background: 'linear-gradient(180deg, #f0faf6 0%, var(--base-100) 100%)',
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

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 mt-8">
              <Link href="/services">
                <Button variant="primary" size="lg" className="w-full sm:w-auto">Book a Service</Button>
              </Link>
              <Link href="/spaces">
                <Button variant="secondary" size="lg" className="w-full sm:w-auto">Find a Space</Button>
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
                boxShadow: '0 8px 40px -8px rgba(46,159,130,0.18)',
              }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 80, height: 80, borderRadius: '50%',
                  backgroundColor: 'var(--white)',
                  boxShadow: '0 4px 20px -4px rgba(46,159,130,0.2)',
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
