'use client';

import Link from 'next/link';
import { Home, Building2, Warehouse, Armchair, PartyPopper, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const CATEGORIES = [
  { Icon: Home,         label: 'Residential',  sub: 'Apartments, villas, studios', href: '/spaces?category=Residential', price: 'From AED 30k/yr', topBg: '#f0faf6', topBorder: '#d8f2e8', iconColor: '#2e9f82' },
  { Icon: Building2,    label: 'Commercial',   sub: 'Offices, retail, showrooms',  href: '/spaces?category=Commercial',  price: 'From AED 50k/yr', topBg: '#f0f9ff', topBorder: '#bae6fd', iconColor: '#0ea5e9' },
  { Icon: Warehouse,    label: 'Industrial',   sub: 'Warehouses, cold storage',    href: '/spaces?category=Industrial',  price: 'From AED 40k/yr', topBg: '#f0fdf4', topBorder: '#bbf7d0', iconColor: '#16a34a' },
  { Icon: Armchair,     label: 'Workspaces',   sub: 'Coworking, private offices',  href: '/spaces?category=Workspaces', price: 'From AED 800/mo', topBg: '#f5f3ff', topBorder: '#ddd6fe', iconColor: '#7c3aed' },
  { Icon: PartyPopper,  label: 'Venues',       sub: 'Event halls, weddings',       href: '/spaces?category=Venues',     price: 'From AED 2k/day', topBg: '#fffbeb', topBorder: '#fde68a', iconColor: '#d4a820' },
];

export function LandingSpaces() {
  return (
    <section style={{ background: '#fafaf8', paddingBlock: 80 }}>
      <div className="container">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 40, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#2e9f82', letterSpacing: '0.10em', textTransform: 'uppercase', margin: '0 0 10px' }}>Spaces</p>
            <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 900, color: '#1a1916', letterSpacing: '-0.025em', margin: '0 0 8px', lineHeight: 1.1 }}>
              Every space type.<br />One platform.
            </h2>
            <p style={{ fontSize: 15, color: '#6b6860', margin: 0 }}>5 space categories. Transparent pricing. Digital contracts end-to-end.</p>
          </div>
          <Link href="/spaces" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            border: '1px solid #d8f2e8', borderRadius: 12,
            padding: '10px 18px', textDecoration: 'none',
            color: '#2e9f82', fontSize: 13, fontWeight: 700,
            background: '#f0faf6', whiteSpace: 'nowrap',
          }}>
            View all spaces <ArrowRight size={13} aria-hidden />
          </Link>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          {CATEGORIES.map(({ Icon, label, sub, href, price, topBg, topBorder, iconColor }) => (
            <Link key={label} href={href} style={{
              display: 'flex', flexDirection: 'column',
              background: '#ffffff', border: '1px solid #e8e6e0',
              borderRadius: 18, overflow: 'hidden', textDecoration: 'none',
              boxShadow: '0 2px 8px rgba(15,23,42,0.04)',
              transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.boxShadow = '0 10px 32px rgba(15,23,42,0.10)';
              e.currentTarget.style.borderColor = topBorder;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(15,23,42,0.04)';
              e.currentTarget.style.borderColor = '#e8e6e0';
            }}
            >
              {/* Coloured top */}
              <div style={{ background: topBg, border: `0 0 1px 0 solid ${topBorder}`, borderBottomWidth: 1, borderColor: topBorder, padding: '24px 20px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: '#fff', border: `1px solid ${topBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={22} color={iconColor} strokeWidth={1.8} aria-hidden />
                </div>
                <ArrowRight size={16} color={iconColor} aria-hidden />
              </div>
              {/* Content */}
              <div style={{ padding: '16px 20px 20px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#9b9890', margin: '0 0 4px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{price}</p>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1a1916', margin: '0 0 4px', letterSpacing: '-0.015em' }}>{label}</h3>
                <p style={{ fontSize: 12, color: '#6b6860', margin: 0, lineHeight: 1.5 }}>{sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
