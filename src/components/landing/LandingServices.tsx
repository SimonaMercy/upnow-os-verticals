'use client';

import Link from 'next/link';
import { Wrench, Sparkles, HeartPulse, Droplets, Leaf, Hammer, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const CATEGORIES = [
  { Icon: Wrench,     label: 'Home & Office Maintenance', href: '/services?category=home-office-maintenance', count: '85+', desc: 'AC, plumbing, electrical, painting & more' },
  { Icon: Sparkles,   label: 'Cleaning & Hygiene',        href: '/services?category=cleaning-hygiene',         count: '40+', desc: 'Deep clean, regular, commercial & industrial' },
  { Icon: HeartPulse, label: 'Lifestyle & Wellness',      href: '/services?category=lifestyle-wellness',        count: '30+', desc: 'Personal care, fitness, lifestyle concierge' },
  { Icon: Droplets,   label: 'Water, Pest & Environment', href: '/services?category=water-pest-environmental',  count: '25+', desc: 'Pest control, water tank, disinfection' },
  { Icon: Leaf,       label: 'Outdoor & Landscaping',     href: '/services?category=outdoor-landscaping',       count: '20+', desc: 'Garden maintenance, pool, outdoor cleaning' },
  { Icon: Hammer,     label: 'Renovation & Fit-out',      href: '/services?category=renovation',                count: '15+', desc: 'Full fit-out, tiling, carpentry, flooring' },
];

export function LandingServices() {
  return (
    <section style={{ background: '#f6f8f6', paddingBlock: 80 }}>
      <div className="container">

        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 40, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#047246', letterSpacing: '0.10em', textTransform: 'uppercase', margin: '0 0 10px' }}>Services</p>
            <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 900, color: '#14201a', letterSpacing: '-0.025em', margin: '0 0 8px', lineHeight: 1.1 }}>
              Whatever your home needs,<br />we have someone for it.
            </h2>
            <p style={{ fontSize: 15, color: '#5f6b63', margin: 0 }}>200+ verified services across the UAE. Fixed price or inspection-based.</p>
          </div>
          <Link href="/services" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            border: '1px solid #d8efe3', borderRadius: 12,
            padding: '10px 18px', textDecoration: 'none',
            color: '#047246', fontSize: 13, fontWeight: 700,
            background: '#eef7f2', whiteSpace: 'nowrap',
          }}>
            Browse all services <ArrowRight size={13} aria-hidden />
          </Link>
        </div>

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          {CATEGORIES.map(({ Icon, label, href, count, desc }) => (
            <Link key={label} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              background: '#ffffff', border: '1px solid #e4e9e5',
              borderRadius: 16, padding: '18px 20px', textDecoration: 'none',
              boxShadow: '0 2px 8px rgba(15,23,42,0.04)',
              transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 10px 32px rgba(15,23,42,0.08)';
              e.currentTarget.style.borderColor = '#d8efe3';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(15,23,42,0.04)';
              e.currentTarget.style.borderColor = '#e4e9e5';
            }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: '#eef7f2', border: '1px solid #d8efe3',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon size={20} color="#047246" strokeWidth={1.8} aria-hidden />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#14201a', margin: '0 0 3px' }}>{label}</p>
                <p style={{ fontSize: 12, color: '#8a948d', margin: 0 }}>{desc}</p>
              </div>
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                <p style={{ fontSize: 14, fontWeight: 800, color: '#047246', margin: 0 }}>{count}</p>
                <ArrowRight size={14} color="#d8efe3" aria-hidden />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
