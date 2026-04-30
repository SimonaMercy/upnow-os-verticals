'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

const SUGGESTIONS: Record<'services' | 'spaces', string[]> = {
  services: ['AC Service', 'Home Cleaning', 'Plumbing', 'Pest Control'],
  spaces:   ['Dubai Marina', 'Business Bay', 'JLT Office', 'Warehouse'],
};

export function LandingHero() {
  const [tab, setTab] = useState<'services' | 'spaces'>('services');
  const [q, setQ] = useState('');

  const dest =
    tab === 'services'
      ? `/services${q ? `?q=${encodeURIComponent(q)}` : ''}`
      : `/spaces${q ? `?q=${encodeURIComponent(q)}` : ''}`;

  return (
    <section
      style={{
        position: 'relative',
        overflow: 'hidden',
        paddingTop: 80,
        paddingBottom: 96,
        background: '#fafaf8',
      }}
    >
      {/* Radial glow */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '-25%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 1000,
          height: 640,
          background:
            'radial-gradient(ellipse at center, rgba(46,159,130,0.09) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      {/* Subtle grid overlay */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(46,159,130,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(46,159,130,0.035) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          pointerEvents: 'none',
        }}
      />

      <div className="container" style={{ position: 'relative', zIndex: 1 }}>
        {/* Live badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: 'rgba(46,159,130,0.07)',
            border: '1px solid rgba(46,159,130,0.22)',
            borderRadius: 9999,
            padding: '5px 14px 5px 8px',
            marginBottom: 28,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: '#2e9f82',
              boxShadow: '0 0 0 3px rgba(46,159,130,0.22)',
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a7560' }}>
            Now live across all 7 Emirates
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            fontSize: 'clamp(38px, 5.5vw, 68px)',
            fontWeight: 800,
            lineHeight: 1.06,
            letterSpacing: '-0.03em',
            color: '#1a1916',
            maxWidth: 660,
            margin: '0 0 20px',
          }}
        >
          Services &amp; spaces
          <br />
          <span
            style={{
              background: 'linear-gradient(120deg, #2e9f82 10%, #1a5a4a 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            built for the UAE.
          </span>
        </h1>

        <p
          style={{
            fontSize: 18,
            color: '#6b6860',
            maxWidth: 460,
            lineHeight: 1.65,
            margin: '0 0 40px',
          }}
        >
          Book trusted professionals and discover premium rental spaces — all in one place.
        </p>

        {/* Search card */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: 20,
            boxShadow: '0 4px 48px -8px rgba(0,0,0,0.12), 0 0 0 1px #ebebeb',
            maxWidth: 620,
            overflow: 'hidden',
          }}
        >
          {/* Tab switcher */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #f4f3ef',
              padding: '6px 6px 0',
              gap: 4,
            }}
          >
            {(['services', 'spaces'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  color: tab === t ? '#2e9f82' : '#9b9890',
                  background: 'none',
                  borderBottom: tab === t ? '2px solid #2e9f82' : '2px solid transparent',
                  transition: 'color 0.2s, border-color 0.2s',
                }}
              >
                {t === 'services' ? '🔧  Book a Service' : '🏠  Find a Space'}
              </button>
            ))}
          </div>

          {/* Input + CTA */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 10px 10px 18px',
            }}
          >
            <Search size={17} color="#c4c2bc" strokeWidth={2.5} style={{ flexShrink: 0 }} />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') window.location.assign(dest);
              }}
              placeholder={
                tab === 'services'
                  ? 'What do you need? (AC, cleaning, plumbing…)'
                  : 'Area, type or keyword (Dubai Marina, office…)'
              }
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                fontSize: 15,
                color: '#1a1916',
                background: 'transparent',
                padding: '10px 0',
              }}
            />
            <Link
              href={dest}
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                backgroundColor: '#2e9f82',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
                padding: '12px 20px',
                borderRadius: 12,
                textDecoration: 'none',
              }}
            >
              Search
            </Link>
          </div>
        </div>

        {/* Quick suggestions */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            marginTop: 14,
          }}
        >
          <span style={{ fontSize: 12, color: '#b5b3ac', fontWeight: 500 }}>Popular:</span>
          {SUGGESTIONS[tab].map((s) => (
            <Link
              key={s}
              href={
                tab === 'services'
                  ? `/services?q=${encodeURIComponent(s)}`
                  : `/spaces?q=${encodeURIComponent(s)}`
              }
              style={{
                fontSize: 13,
                color: '#4f4c44',
                background: '#ffffff',
                border: '1px solid #e4e2dc',
                borderRadius: 9999,
                padding: '4px 12px',
                textDecoration: 'none',
              }}
            >
              {s}
            </Link>
          ))}
        </div>

        {/* Trust stats */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 40px',
            marginTop: 56,
            paddingTop: 40,
            borderTop: '1px solid #e8e6e0',
          }}
        >
          {[
            { num: '500+',   label: 'Verified Providers' },
            { num: '10,000+', label: 'Jobs Completed'   },
            { num: '4.9★',  label: 'Average Rating'     },
            { num: '7',     label: 'Emirates Covered'   },
          ].map(({ num, label }) => (
            <div key={label} style={{ minWidth: 80 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 26,
                  fontWeight: 800,
                  color: '#1a1916',
                  letterSpacing: '-0.02em',
                }}
              >
                {num}
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: '#9b9890',
                  marginTop: 3,
                  fontWeight: 500,
                }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
