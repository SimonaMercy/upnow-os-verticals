'use client';

import Link from 'next/link';
import { Home, Building2, Warehouse, Armchair, PartyPopper, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const FEATURED = [
  { Icon: Home,        label: 'Residential', sub: 'Apartments, villas, studios, townhouses', href: '/spaces?category=Residential', price: 'From AED 30k/yr', color: '#8b6050', bg: 'linear-gradient(145deg, #3a1f14 0%, #5c3020 100%)' },
  { Icon: Building2,   label: 'Commercial',  sub: 'Offices, retail, showrooms, clinics',      href: '/spaces?category=Commercial',  price: 'From AED 50k/yr', color: '#5a7aad', bg: 'linear-gradient(145deg, #0e1e38 0%, #1a3060 100%)' },
  { Icon: Warehouse,   label: 'Industrial',  sub: 'Warehouses, cold storage, logistics',       href: '/spaces?category=Industrial',  price: 'From AED 40k/yr', color: '#6a9060', bg: 'linear-gradient(145deg, #1a2e18 0%, #2c5028 100%)' },
  { Icon: Armchair,    label: 'Workspaces',  sub: 'Coworking desks, private offices, meeting rooms', href: '/spaces?category=Workspaces', price: 'From AED 800/mo', color: '#9060b0', bg: 'linear-gradient(145deg, #1e1030 0%, #381a5a 100%)' },
  { Icon: PartyPopper, label: 'Venues',      sub: 'Event halls, wedding venues, conference halls', href: '/spaces?category=Venues', price: 'From AED 2k/day', color: '#c07040', bg: 'linear-gradient(145deg, #2e1a08 0%, #4e2c10 100%)' },
];

export function LandingSpaces() {
  return (
    <section style={{ backgroundColor: '#fafaf8', paddingBlock: 88 }}>
      <div className="container">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 48, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#2e9f82', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12, margin: '0 0 12px' }}>Spaces</p>
            <h2 style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 900, color: '#1a1916', letterSpacing: '-0.03em', margin: '0 0 10px', lineHeight: 1.1 }}>
              Every space type.<br />
              <span style={{ color: '#2e9f82' }}>One platform.</span>
            </h2>
            <p style={{ fontSize: 16, color: '#6b6860', margin: 0 }}>5 space categories. Transparent pricing. End-to-end digital contracts.</p>
          </div>
          <Link href="/spaces" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            border: '1px solid #c8ead8', borderRadius: 12, padding: '12px 22px',
            textDecoration: 'none', color: '#2e9f82', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap',
            background: '#f0faf6',
          }}>
            View all spaces <ArrowRight size={14} />
          </Link>
        </div>

        {/* Horizontal scroll on mobile, 5-col grid on desktop */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {FEATURED.map(({ Icon, label, sub, href, price, color, bg }) => (
            <Link key={label} href={href} style={{
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              height: 260, padding: 24, borderRadius: 18, background: bg,
              textDecoration: 'none', position: 'relative', overflow: 'hidden',
              transition: 'transform 0.25s, box-shadow 0.25s',
              boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-5px) scale(1.02)'; e.currentTarget.style.boxShadow = `0 20px 48px rgba(0,0,0,0.22)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0) scale(1)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.12)'; }}
            >
              <div aria-hidden style={{ position: 'absolute', top: -40, right: -40, width: 130, height: 130, borderRadius: '50%', background: `radial-gradient(circle, ${color}30 0%, transparent 70%)`, pointerEvents: 'none' }} />

              <div style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={20} color="rgba(255,255,255,0.90)" strokeWidth={1.8} />
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>{price}</div>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: '0 0 5px', letterSpacing: '-0.015em' }}>{label}</h3>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.58)', margin: '0 0 14px', lineHeight: 1.5 }}>{sub}</p>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,0.16)', borderRadius: 9999, padding: '5px 12px' }}>
                  Explore <ArrowRight size={11} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
