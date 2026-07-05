/**
 * Public /services — the customer-facing service catalog.
 *
 * The catalog body (categories → services → sub-type packages, prices) is
 * rendered by ServicesCatalogClient from GET /api/catalog/public — i.e. it
 * shows EXACTLY what the admin configures in /dashboard/admin/catalog, with
 * zero hardcoded taxonomy. This wrapper keeps the marketing shell: SEO
 * metadata, hero, and the provider-recruitment CTA.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import ServicesCatalogClient from './ServicesCatalogClient';

export const metadata: Metadata = {
  title: 'Browse Services — UpNow',
  description:
    'Home cleaning, AC, plumbing, electrical, handyman, painting, pest control, car care and more — trusted, licensed providers across the UAE at transparent prices.',
};

export default function ServicesPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section style={{ background: 'linear-gradient(180deg, #f0faf6 0%, #fff 100%)', paddingBlock: '64px 56px' }}>
        <div className="container text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--primary)' }}>
            Home &amp; Business Services
          </p>
          <h1
            className="mt-4 font-bold"
            style={{ fontSize: 48, lineHeight: 1.1, color: 'var(--neutral-900)', letterSpacing: '-0.02em' }}
          >
            Trusted Services Across UAE
          </h1>
          <p className="mt-4 mx-auto max-w-[540px] text-lg" style={{ color: 'var(--neutral-500)', lineHeight: 1.7 }}>
            Transparent prices, vetted licensed providers — from a one-hour clean
            to a full AC service, see exactly what it costs before you book.
          </p>

          {/* Booking status badge — flips off with SP Sprint 2 */}
          <div
            className="mt-8 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: '#fef9c3', color: '#92400e' }}
          >
            <Zap size={14} />
            Online booking opens soon — browse services and prices below
          </div>
        </div>
      </section>

      {/* Admin-configured catalog */}
      <section className="container py-12">
        <ServicesCatalogClient />
      </section>

      {/* Provider recruitment CTA */}
      <section
        className="container mb-16"
        style={{
          backgroundColor: 'var(--primary)',
          borderRadius: 20,
          padding: '48px 40px',
          color: '#fff',
        }}
      >
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-2xl font-bold">Are you a service provider?</h2>
            <p className="mt-2 opacity-80">Join UpNow and reach thousands of property owners and customers.</p>
          </div>
          <Link
            href="/register/service-provider"
            className="flex-shrink-0 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#fff', color: 'var(--primary)' }}
          >
            Register as Provider
          </Link>
        </div>
      </section>
    </div>
  );
}
