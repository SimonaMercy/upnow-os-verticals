import type { Metadata } from 'next';
import Link from 'next/link';
import { Wrench, Zap, Droplets, Thermometer, Paintbrush, Truck, Shield, Leaf } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Browse Services — UpNow',
  description: 'Find trusted home and business services across the UAE.',
};

const SERVICE_CATEGORIES = [
  {
    icon: Wrench,
    title: 'Maintenance & Repair',
    description: 'General handyman, carpentry, plumbing repairs, door & lock fixes.',
    color: '#dbeafe',
    iconColor: '#1d4ed8',
    query: 'maintenance',
  },
  {
    icon: Zap,
    title: 'Electrical',
    description: 'Wiring, panel upgrades, lighting installation, EV charger setup.',
    color: '#fef9c3',
    iconColor: '#ca8a04',
    query: 'electrical',
  },
  {
    icon: Droplets,
    title: 'Plumbing',
    description: 'Pipe repairs, installations, drainage, water heater services.',
    color: '#dbeafe',
    iconColor: '#0369a1',
    query: 'plumbing',
  },
  {
    icon: Thermometer,
    title: 'HVAC & AC',
    description: 'AC servicing, duct cleaning, installation & annual maintenance contracts.',
    color: '#dcfce7',
    iconColor: '#15803d',
    query: 'hvac',
  },
  {
    icon: Paintbrush,
    title: 'Painting & Finishing',
    description: 'Interior & exterior painting, wall textures, tile & grouting.',
    color: '#fce7f3',
    iconColor: '#db2777',
    query: 'painting',
  },
  {
    icon: Truck,
    title: 'Moving & Relocation',
    description: 'Home & office moves, furniture assembly, storage solutions.',
    color: '#fef3c7',
    iconColor: '#d97706',
    query: 'moving',
  },
  {
    icon: Shield,
    title: 'Security & CCTV',
    description: 'Camera installation, access control, alarm systems.',
    color: '#f3e8ff',
    iconColor: '#7c3aed',
    query: 'security',
  },
  {
    icon: Leaf,
    title: 'Cleaning & Landscaping',
    description: 'Deep cleaning, regular maid service, garden & pool maintenance.',
    color: '#d1fae5',
    iconColor: '#059669',
    query: 'cleaning',
  },
];

export default function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
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
            From AC maintenance to full home renovations — find verified professionals ready to help.
          </p>

          {/* Coming soon badge */}
          <div className="mt-8 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: '#fef9c3', color: '#92400e' }}>
            <Zap size={14} />
            Service booking coming soon — browse categories below
          </div>
        </div>
      </section>

      {/* Category grid */}
      <section className="container py-12">
        <h2 className="text-2xl font-bold mb-8" style={{ color: 'var(--neutral-900)' }}>
          Browse by Category
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {SERVICE_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <Link
                key={cat.query}
                href={`/services?q=${cat.query}`}
                className="group block rounded-2xl p-6 border border-[#e8e6e0] hover:shadow-lg transition-all hover:-translate-y-0.5"
                style={{ backgroundColor: '#fff' }}
              >
                <div
                  className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4"
                  style={{ backgroundColor: cat.color }}
                >
                  <Icon size={22} style={{ color: cat.iconColor }} />
                </div>
                <h3 className="font-semibold text-base mb-1.5" style={{ color: 'var(--neutral-900)' }}>
                  {cat.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--neutral-500)' }}>
                  {cat.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* CTA */}
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
