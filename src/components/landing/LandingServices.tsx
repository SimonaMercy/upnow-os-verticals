'use client';

import Link from 'next/link';
import { Wrench, Sparkles, HeartPulse, LayoutGrid, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const CATEGORIES = [
  {
    Icon: Wrench,
    title: 'Home & Office',
    desc: 'AC, plumbing, electrical, carpentry, appliances',
    href: '/services?category=home-office-maintenance',
    accent: '#d4a820',
  },
  {
    Icon: Sparkles,
    title: 'Cleaning & Hygiene',
    desc: 'Home, office, deep cleaning, fabric, sanitization',
    href: '/services?category=cleaning-hygiene',
    accent: '#2e9f82',
  },
  {
    Icon: HeartPulse,
    title: 'Lifestyle & Wellness',
    desc: 'Grooming, healthcare, pet care, family support',
    href: '/services?category=lifestyle-wellness',
    accent: '#e07575',
  },
  {
    Icon: LayoutGrid,
    title: 'Browse All Services',
    desc: 'Explore 200+ services from verified providers',
    href: '/services',
    accent: '#7c9cd4',
  },
];

export function LandingServices() {
  return (
    <section style={{ backgroundColor: '#1a1916', paddingBlock: 80 }}>
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
            Services
          </p>
          <h2
            style={{
              fontSize: 'clamp(28px, 3.5vw, 42px)',
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              maxWidth: 480,
              margin: 0,
            }}
          >
            Book a professional,{' '}
            <span style={{ color: '#2e9f82' }}>today.</span>
          </h2>
          <p
            style={{
              color: 'rgba(255,255,255,0.50)',
              fontSize: 17,
              marginTop: 12,
              maxWidth: 420,
              lineHeight: 1.6,
            }}
          >
            200+ verified service categories across the UAE.
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
          {CATEGORIES.map(({ Icon, title, desc, href, accent }) => (
            <ServiceCard
              key={title}
              Icon={Icon}
              title={title}
              desc={desc}
              href={href}
              accent={accent}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ServiceCard({
  Icon,
  title,
  desc,
  href,
  accent,
}: {
  Icon: LucideIcon;
  title: string;
  desc: string;
  href: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 28,
        borderRadius: 18,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.09)',
        textDecoration: 'none',
        transition: 'background 0.2s, border-color 0.2s, transform 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
        e.currentTarget.style.borderColor = `${accent}50`;
        e.currentTarget.style.transform = 'translateY(-3px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: `${accent}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={20} color={accent} strokeWidth={1.8} />
      </div>
      <div style={{ flex: 1 }}>
        <h3
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: '#ffffff',
            margin: '0 0 6px',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.48)',
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {desc}
        </p>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          color: accent,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        View services <ArrowRight size={13} />
      </div>
    </Link>
  );
}
