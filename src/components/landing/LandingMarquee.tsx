'use client';

import Link from 'next/link';

const ITEMS = [
  { label: 'AC Service', emoji: '❄️', href: '/services?category=home-office-maintenance' },
  { label: 'Home Cleaning', emoji: '✨', href: '/services?category=cleaning-hygiene' },
  { label: 'Pest Control', emoji: '🐛', href: '/services?category=cleaning-hygiene' },
  { label: 'Plumbing', emoji: '🔩', href: '/services?category=home-office-maintenance' },
  { label: 'Electrical', emoji: '⚡', href: '/services?category=home-office-maintenance' },
  { label: 'Painting', emoji: '🎨', href: '/services?category=home-office-maintenance' },
  { label: 'Landscaping', emoji: '🌿', href: '/services?category=outdoor-landscaping' },
  { label: 'Pool Cleaning', emoji: '🏊', href: '/services?category=outdoor-landscaping' },
  { label: 'Carpentry', emoji: '🪚', href: '/services?category=home-office-maintenance' },
  { label: 'Deep Cleaning', emoji: '🧹', href: '/services?category=cleaning-hygiene' },
];

const DOUBLED = [...ITEMS, ...ITEMS];

export function LandingMarquee() {
  return (
    <div style={{
      backgroundColor: '#111110',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      padding: '0',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Left fade */}
      <div aria-hidden style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 120,
        background: 'linear-gradient(90deg, #111110 0%, transparent 100%)',
        zIndex: 2, pointerEvents: 'none',
      }} />
      {/* Right fade */}
      <div aria-hidden style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: 120,
        background: 'linear-gradient(270deg, #111110 0%, transparent 100%)',
        zIndex: 2, pointerEvents: 'none',
      }} />

      <div style={{
        display: 'flex',
        animation: 'marquee 32s linear infinite',
        width: 'max-content',
      }}>
        {DOUBLED.map((item, i) => (
          <Link
            key={i}
            href={item.href}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '14px 28px', textDecoration: 'none', whiteSpace: 'nowrap',
              fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.45)',
              transition: 'color 0.2s',
              borderRight: '1px solid rgba(255,255,255,0.06)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.45)'; }}
          >
            <span>{item.emoji}</span>
            {item.label}
          </Link>
        ))}
      </div>

      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
