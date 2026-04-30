'use client';

import Link from 'next/link';

const ITEMS = [
  { label: 'AC Service',      emoji: '❄️', href: '/services?category=home-office-maintenance' },
  { label: 'Home Cleaning',   emoji: '🧹', href: '/services?category=cleaning-hygiene' },
  { label: 'Pest Control',    emoji: '🐛', href: '/services?category=cleaning-hygiene' },
  { label: 'Plumbing',        emoji: '🔩', href: '/services?category=home-office-maintenance' },
  { label: 'Electrical',      emoji: '⚡', href: '/services?category=home-office-maintenance' },
  { label: 'Painting',        emoji: '🎨', href: '/services?category=home-office-maintenance' },
  { label: 'Landscaping',     emoji: '🌿', href: '/services?category=outdoor-landscaping' },
  { label: 'Pool Cleaning',   emoji: '🏊', href: '/services?category=outdoor-landscaping' },
  { label: 'Carpentry',       emoji: '🪚', href: '/services?category=home-office-maintenance' },
  { label: 'Deep Cleaning',   emoji: '✨', href: '/services?category=cleaning-hygiene' },
];

const DOUBLED = [...ITEMS, ...ITEMS];

export function LandingMarquee() {
  return (
    <div style={{
      background: '#ffffff',
      borderTop: '1px solid #e8e6e0', borderBottom: '1px solid #e8e6e0',
      overflow: 'hidden', position: 'relative', padding: 0,
    }}>
      <div aria-hidden style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 80,
        background: 'linear-gradient(90deg, #fff 0%, transparent 100%)',
        zIndex: 2, pointerEvents: 'none',
      }} />
      <div aria-hidden style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: 80,
        background: 'linear-gradient(270deg, #fff 0%, transparent 100%)',
        zIndex: 2, pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', animation: 'marquee 36s linear infinite', width: 'max-content' }}>
        {DOUBLED.map((item, i) => (
          <Link key={i} href={item.href} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '13px 24px', textDecoration: 'none', whiteSpace: 'nowrap',
            fontSize: 13, fontWeight: 600, color: '#6b6860',
            transition: 'color 0.18s',
            borderRight: '1px solid #f0f0ec',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#2e9f82'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#6b6860'; }}
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
