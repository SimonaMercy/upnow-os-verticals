'use client';

import Link from 'next/link';
import { Wrench, Sparkles, HeartPulse, Droplets, Leaf, Hammer, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const CATEGORIES = [
  { Icon: Wrench,    label: 'Home & Office Maintenance', href: '/services?category=home-office-maintenance', count: '85+' },
  { Icon: Sparkles,  label: 'Cleaning & Hygiene',        href: '/services?category=cleaning-hygiene',         count: '40+' },
  { Icon: HeartPulse,label: 'Lifestyle & Wellness',      href: '/services?category=lifestyle-wellness',        count: '30+' },
  { Icon: Droplets,  label: 'Water, Pest & Environment', href: '/services?category=water-pest-environmental',  count: '25+' },
  { Icon: Leaf,      label: 'Outdoor & Landscaping',     href: '/services?category=outdoor-landscaping',       count: '20+' },
  { Icon: Hammer,    label: 'Renovation & Fit-out',      href: '/services?category=renovation',                count: '15+' },
];

export function LandingServices() {
  return (
    <section style={{ backgroundColor: '#0f0f0d', paddingBlock: 88 }}>
      <div className="container">

        {/* Top row: headline + CTA */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 48, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#2e9f82', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12, margin: '0 0 12px' }}>Services</p>
            <h2 style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.03em', margin: '0 0 10px', lineHeight: 1.1 }}>
              Whatever your home needs,<br />
              <span style={{ color: '#2e9f82' }}>we have someone for it.</span>
            </h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', margin: 0 }}>200+ verified services. Fixed price or inspection-based quote.</p>
          </div>
          <Link href="/services" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            border: '1px solid rgba(46,159,130,0.35)', borderRadius: 12,
            padding: '12px 22px', textDecoration: 'none',
            color: '#2e9f82', fontSize: 14, fontWeight: 700,
            whiteSpace: 'nowrap',
          }}>
            Browse all services <ArrowRight size={14} />
          </Link>
        </div>

        {/* Category list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {CATEGORIES.map(({ Icon, label, href, count }, i) => (
            <CategoryRow key={label} Icon={Icon} label={label} href={href} count={count} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CategoryRow({ Icon, label, href, count }: { Icon: LucideIcon; label: string; href: string; count: string }) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex', alignItems: 'center', gap: 20,
        padding: '22px 0',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        textDecoration: 'none',
        transition: 'background 0.2s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.paddingLeft = '12px'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.paddingLeft = '0px'; }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(46,159,130,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        transition: 'background 0.2s',
      }}>
        <Icon size={20} color="#2e9f82" strokeWidth={1.8} />
      </div>
      <span style={{ flex: 1, fontSize: 18, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.01em' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.30)', fontWeight: 600 }}>{count} services</span>
      <ArrowRight size={16} color="rgba(255,255,255,0.25)" strokeWidth={2} />
    </Link>
  );
}
