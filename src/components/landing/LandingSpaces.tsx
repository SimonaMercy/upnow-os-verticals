'use client';

import Link from 'next/link';
import { Home, Building2, Warehouse, LayoutGrid, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const CATEGORIES = [
  {
    Icon: Home,
    title: 'Residential',
    desc: 'Apartments, villas, studios, penthouses, townhouses',
    href: '/spaces?category=Residential',
    bg: 'linear-gradient(140deg, #5c4033 0%, #8b6050 100%)',
  },
  {
    Icon: Building2,
    title: 'Commercial',
    desc: 'Offices, coworking, retail units, showrooms, clinics',
    href: '/spaces?category=Commercial',
    bg: 'linear-gradient(140deg, #2b3d5b 0%, #3d5a8a 100%)',
  },
  {
    Icon: Warehouse,
    title: 'Industrial',
    desc: 'Warehouses, storage, cold storage, logistics units',
    href: '/spaces?category=Industrial',
    bg: 'linear-gradient(140deg, #3a4a38 0%, #567050 100%)',
  },
  {
    Icon: LayoutGrid,
    title: 'All Spaces',
    desc: 'Workspaces, venues, and every space type in the UAE',
    href: '/spaces',
    bg: 'linear-gradient(140deg, #1a5a4a 0%, #2e9f82 100%)',
  },
];

export function LandingSpaces() {
  return (
    <section style={{ backgroundColor: '#f4f3ef', paddingBlock: 80 }}>
      <div className="container">
        {/* Header */}
        <div style={{ marginBottom: 44 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#2e9f82',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            Spaces
          </p>
          <h2
            style={{
              fontSize: 'clamp(28px, 3.5vw, 42px)',
              fontWeight: 800,
              color: '#1a1916',
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              maxWidth: 480,
              margin: 0,
            }}
          >
            Find your perfect{' '}
            <span style={{ color: '#2e9f82' }}>space.</span>
          </h2>
          <p
            style={{
              color: '#6b6860',
              fontSize: 17,
              marginTop: 12,
              maxWidth: 420,
              lineHeight: 1.6,
            }}
          >
            Residential, commercial, industrial, and more.
          </p>
        </div>

        {/* Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 14,
          }}
        >
          {CATEGORIES.map(({ Icon, title, desc, href, bg }) => (
            <SpaceCard key={title} Icon={Icon} title={title} desc={desc} href={href} bg={bg} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SpaceCard({
  Icon,
  title,
  desc,
  href,
  bg,
}: {
  Icon: LucideIcon;
  title: string;
  desc: string;
  href: string;
  bg: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: 240,
        padding: 28,
        borderRadius: 18,
        background: bg,
        textDecoration: 'none',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        transition: 'transform 0.25s, box-shadow 0.25s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px) scale(1.01)';
        e.currentTarget.style.boxShadow = '0 16px 40px rgba(0,0,0,0.18)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0) scale(1)';
        e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)';
      }}
    >
      {/* Subtle highlight shimmer */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 160,
          height: 160,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: 'rgba(255,255,255,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={22} color="rgba(255,255,255,0.92)" strokeWidth={1.8} />
      </div>

      <div>
        <h3
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: '#ffffff',
            margin: '0 0 6px',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.70)',
            margin: '0 0 16px',
            lineHeight: 1.5,
          }}
        >
          {desc}
        </p>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            color: '#ffffff',
            background: 'rgba(255,255,255,0.18)',
            borderRadius: 9999,
            padding: '6px 14px',
          }}
        >
          Explore <ArrowRight size={12} />
        </span>
      </div>
    </Link>
  );
}
