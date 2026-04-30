'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, ArrowRight, Star, Shield, Zap } from 'lucide-react';

const TABS = [
  { key: 'services', label: '⚡ Book a Service', placeholder: 'AC repair, cleaning, plumbing…' },
  { key: 'spaces',   label: '🏠 Find a Space',   placeholder: 'Dubai Marina, Business Bay, JLT…' },
] as const;

const SUGGESTIONS: Record<'services'|'spaces', string[]> = {
  services: ['AC Repair', 'Home Cleaning', 'Pest Control', 'Painting'],
  spaces:   ['Dubai Marina', 'Business Bay', 'JLT Offices', 'Warehouse DIP'],
};

const PREVIEW_SERVICES = [
  { emoji: '🧹', name: 'Home Cleaning',  price: 'AED 120', badge: 'Fixed', rating: '4.9', jobs: '312' },
  { emoji: '❄️', name: 'AC Service',     price: 'Quote',   badge: 'Inspection', rating: '4.8', jobs: '256' },
  { emoji: '🔧', name: 'Plumbing Repair',price: 'Quote',   badge: 'Inspection', rating: '4.7', jobs: '198' },
];

export function LandingHero() {
  const [tab, setTab] = useState<'services'|'spaces'>('services');
  const [q, setQ] = useState('');
  const dest = tab === 'services'
    ? `/services${q ? `?q=${encodeURIComponent(q)}` : ''}`
    : `/spaces${q ? `?q=${encodeURIComponent(q)}` : ''}`;

  return (
    <section style={{
      position: 'relative', overflow: 'hidden',
      background: `
        radial-gradient(circle at 8% -8%, rgba(46,159,130,.14), transparent 40%),
        radial-gradient(circle at 92% -6%, rgba(46,159,130,.08), transparent 40%),
        #fafaf8
      `,
      paddingTop: 72, paddingBottom: 80,
    }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 48, alignItems: 'center' }}
          className="lg:grid-cols-2-hero">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 48, alignItems: 'center' }}>

            {/* ── Left ── */}
            <div>
              {/* Eyebrow badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                border: '1px solid #d8f2e8', borderRadius: 9999,
                padding: '5px 14px 5px 8px', marginBottom: 28,
                background: '#f0faf6',
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2e9f82', display: 'inline-block' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#1a5a4a', letterSpacing: '0.04em' }}>
                  Live across all 7 Emirates
                </span>
              </div>

              {/* Headline */}
              <h1 style={{
                fontSize: 'clamp(36px, 5vw, 60px)', fontWeight: 900,
                lineHeight: 1.08, letterSpacing: '-0.03em',
                color: '#1a1916', margin: '0 0 20px',
              }}>
                Your home.<br />
                Your space.<br />
                <span style={{ color: '#2e9f82' }}>Your city.</span>
              </h1>

              <p style={{ fontSize: 16, color: '#6b6860', lineHeight: 1.65, maxWidth: 420, margin: '0 0 36px' }}>
                Book trusted professionals for your home. Discover premium spaces to live and work — all on one platform.
              </p>

              {/* Search card */}
              <div style={{
                background: '#ffffff', border: '1px solid #e8e6e0',
                borderRadius: 20, overflow: 'hidden',
                boxShadow: '0 10px 32px rgba(15,23,42,0.08)',
                maxWidth: 520,
              }}>
                {/* Tab switcher */}
                <div style={{ display: 'flex', borderBottom: '1px solid #e8e6e0', padding: '4px 4px 0' }}>
                  {TABS.map(({ key, label }) => (
                    <button key={key} onClick={() => setTab(key)} style={{
                      flex: 1, padding: '10px 12px', fontSize: 13, fontWeight: 700,
                      border: 'none', cursor: 'pointer', background: 'none',
                      borderBottom: tab === key ? '2px solid #2e9f82' : '2px solid transparent',
                      color: tab === key ? '#2e9f82' : '#9b9890',
                      transition: 'color 0.15s',
                    }}>
                      {label}
                    </button>
                  ))}
                </div>
                {/* Input row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 8px 16px' }}>
                  <Search size={16} color="#9b9890" style={{ flexShrink: 0 }} aria-hidden />
                  <input
                    type="text"
                    placeholder={TABS.find(t => t.key === tab)!.placeholder}
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    style={{
                      flex: 1, minWidth: 0, border: 'none', outline: 'none',
                      fontSize: 14, color: '#1a1916', background: 'transparent', padding: '8px 0',
                    }}
                  />
                  <Link href={dest} style={{
                    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#2e9f82', color: '#fff', fontWeight: 700, fontSize: 13,
                    padding: '11px 18px', borderRadius: 12, textDecoration: 'none',
                  }}>
                    Search <ArrowRight size={13} aria-hidden />
                  </Link>
                </div>
              </div>

              {/* Quick links */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14 }}>
                <span style={{ fontSize: 12, color: '#9b9890', fontWeight: 500 }}>Try:</span>
                {SUGGESTIONS[tab].map(s => (
                  <Link key={s} href={`/${tab}?q=${encodeURIComponent(s)}`} style={{
                    fontSize: 12, color: '#3d3b35', background: '#fff',
                    border: '1px solid #e8e6e0', borderRadius: 9999, padding: '4px 12px',
                    textDecoration: 'none', fontWeight: 500,
                    transition: 'border-color 0.15s',
                  }}>
                    {s}
                  </Link>
                ))}
              </div>

              {/* Stats strip */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '12px 40px',
                marginTop: 52, paddingTop: 32, borderTop: '1px solid #e8e6e0',
              }}>
                {[
                  { num: '500+',   label: 'Verified Providers' },
                  { num: '10,000+',label: 'Jobs Completed' },
                  { num: '4.9★',  label: 'Average Rating' },
                  { num: 'All 7', label: 'Emirates Covered' },
                ].map(({ num, label }) => (
                  <div key={label}>
                    <span style={{ display: 'block', fontSize: 22, fontWeight: 900, color: '#1a1916', letterSpacing: '-0.02em' }}>{num}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#9b9890', marginTop: 2, fontWeight: 500 }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Right: Product preview card ── */}
            <div className="hidden lg:block">
              <div style={{
                background: '#ffffff', border: '1px solid #e8e6e0',
                borderRadius: 20, padding: 20,
                boxShadow: '0 20px 48px rgba(15,23,42,0.10)',
                width: 320,
              }}>
                {/* Mini header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#9b9890', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Available Services
                  </p>
                  <span style={{ fontSize: 11, color: '#2e9f82', fontWeight: 700 }}>View all →</span>
                </div>
                {/* Service rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {PREVIEW_SERVICES.map(({ emoji, name, price, badge, rating, jobs }) => (
                    <div key={name} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', borderRadius: 12,
                      border: '1px solid #f0faf6', background: '#fafaf8',
                    }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#1a1916', margin: 0 }}>{name}</p>
                        <p style={{ fontSize: 11, color: '#9b9890', margin: 0 }}>★ {rating} · {jobs} jobs</p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 800, color: '#2e9f82', margin: 0 }}>{price}</p>
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          background: badge === 'Fixed' ? '#e0f2fe' : '#fef3c7',
                          color: badge === 'Fixed' ? '#0369a1' : '#92400e',
                          borderRadius: 4, padding: '1px 5px',
                        }}>{badge}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Trust pills */}
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e8e6e0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[
                    { Icon: Shield, text: 'Escrow Protected' },
                    { Icon: Star,   text: 'Verified Providers' },
                    { Icon: Zap,    text: 'Fast Booking' },
                  ].map(({ Icon, text }) => (
                    <span key={text} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, fontWeight: 700, color: '#1a5a4a',
                      background: '#f0faf6', border: '1px solid #d8f2e8',
                      borderRadius: 9999, padding: '4px 10px',
                    }}>
                      <Icon size={10} aria-hidden />
                      {text}
                    </span>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
