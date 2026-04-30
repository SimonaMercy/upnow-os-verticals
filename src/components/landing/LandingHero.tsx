'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, ArrowRight } from 'lucide-react';

const SUGGESTIONS: Record<'services' | 'spaces', string[]> = {
  services: ['AC Repair', 'Home Cleaning', 'Pest Control', 'Painting'],
  spaces:   ['Dubai Marina', 'Business Bay', 'JLT Office', 'Warehouse DIP'],
};

function ServiceCard() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 16, padding: '18px 20px',
      backdropFilter: 'blur(12px)', width: 240,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(46,159,130,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 18 }}>🔧</span>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>AC Service</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Home & Office</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 2 }}>Provider</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>TechCool LLC</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 2 }}>From</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#2e9f82' }}>AED 120</div>
        </div>
      </div>
      <div style={{ marginTop: 14, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#2e9f82', boxShadow: '0 0 0 3px rgba(46,159,130,0.22)' }} />
        <span style={{ fontSize: 12, color: '#2e9f82', fontWeight: 600 }}>Available today</span>
      </div>
    </div>
  );
}

function SpaceCard() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 16, padding: '18px 20px',
      backdropFilter: 'blur(12px)', width: 240,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(212,168,32,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 18 }}>🏙️</span>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>2BR Apartment</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Dubai Marina</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 2 }}>Size</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>1,240 sqft</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 2 }}>Annual</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#d4a820' }}>AED 85k</div>
        </div>
      </div>
      <div style={{ marginTop: 14, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1,2,3,4,5].map(i => (
            <span key={i} style={{ fontSize: 11, color: i <= 4 ? '#d4a820' : 'rgba(255,255,255,0.2)' }}>★</span>
          ))}
        </div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>4.8 (32 reviews)</span>
      </div>
    </div>
  );
}

export function LandingHero() {
  const [tab, setTab] = useState<'services' | 'spaces'>('services');
  const [q, setQ] = useState('');

  const dest =
    tab === 'services'
      ? `/services${q ? `?q=${encodeURIComponent(q)}` : ''}`
      : `/spaces${q ? `?q=${encodeURIComponent(q)}` : ''}`;

  return (
    <section style={{
      position: 'relative', background: '#0d0d0b',
      paddingTop: 90, paddingBottom: 100, overflow: 'hidden',
      minHeight: '92vh', display: 'flex', alignItems: 'center',
    }}>
      <div aria-hidden style={{ position: 'absolute', top: '-10%', left: '-5%', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle, rgba(46,159,130,0.12) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: '0%', right: '10%', width: 500, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(212,168,32,0.07) 0%, transparent 65%)', pointerEvents: 'none' }} />

      <div className="container" style={{ position: 'relative', zIndex: 1, width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 48, alignItems: 'center' }}>

          {/* Left column */}
          <div style={{ maxWidth: 620 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              border: '1px solid rgba(46,159,130,0.30)', borderRadius: 9999,
              padding: '5px 14px 5px 8px', marginBottom: 32,
              background: 'rgba(46,159,130,0.07)',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#2e9f82', display: 'inline-block', boxShadow: '0 0 0 3px rgba(46,159,130,0.22)' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#4ec9a8' }}>Live across all 7 Emirates</span>
            </div>

            <h1 style={{
              fontSize: 'clamp(44px, 6vw, 76px)', fontWeight: 900,
              lineHeight: 1.0, letterSpacing: '-0.035em', color: '#ffffff',
              margin: '0 0 24px',
            }}>
              Your home.
              <br />
              Your space.
              <br />
              <span style={{
                background: 'linear-gradient(95deg, #2e9f82 0%, #4ec9a8 50%, #d4a820 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>
                Your city.
              </span>
            </h1>

            <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.50)', lineHeight: 1.65, maxWidth: 440, margin: '0 0 40px' }}>
              Book trusted professionals for your home. Discover premium spaces to live and work — all on one platform.
            </p>

            <div style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 20, maxWidth: 560, overflow: 'hidden', backdropFilter: 'blur(12px)',
            }}>
              <div style={{ display: 'flex', padding: '6px 6px 0', gap: 4 }}>
                {(['services', 'spaces'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} style={{
                    flex: 1, padding: '10px 16px', fontSize: 13, fontWeight: 700,
                    border: 'none', cursor: 'pointer', background: 'none',
                    color: tab === t ? '#2e9f82' : 'rgba(255,255,255,0.35)',
                    borderBottom: tab === t ? '2px solid #2e9f82' : '2px solid transparent',
                    transition: 'color 0.18s, border-color 0.18s',
                  }}>
                    {t === 'services' ? '⚡  Book a Service' : '🏠  Find a Space'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px 10px 16px' }}>
                <Search size={16} color="rgba(255,255,255,0.28)" strokeWidth={2.5} style={{ flexShrink: 0 }} />
                <input
                  type="text" value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') window.location.assign(dest); }}
                  placeholder={tab === 'services' ? 'AC, cleaning, plumbing…' : 'Dubai Marina, office, warehouse…'}
                  style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 15, color: '#ffffff', background: 'transparent', padding: '10px 0' }}
                />
                <Link href={dest} style={{
                  flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
                  backgroundColor: '#2e9f82', color: '#fff', fontWeight: 700, fontSize: 14,
                  padding: '12px 20px', borderRadius: 12, textDecoration: 'none',
                }}>
                  Search <ArrowRight size={14} />
                </Link>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', fontWeight: 500 }}>Try:</span>
              {SUGGESTIONS[tab].map((s) => (
                <Link key={s}
                  href={tab === 'services' ? `/services?q=${encodeURIComponent(s)}` : `/spaces?q=${encodeURIComponent(s)}`}
                  style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 9999, padding: '4px 12px', textDecoration: 'none' }}>
                  {s}
                </Link>
              ))}
            </div>
          </div>

          {/* Right column — floating cards */}
          <div className="hidden lg:flex" style={{ flexDirection: 'column', gap: 14, position: 'relative' }}>
            <div style={{ transform: 'translateX(28px)' }}><ServiceCard /></div>
            <div style={{ transform: 'translateX(-16px)' }}><SpaceCard /></div>
            <div style={{
              position: 'absolute', bottom: -24, right: 0,
              background: 'rgba(46,159,130,0.12)', border: '1px solid rgba(46,159,130,0.28)',
              borderRadius: 12, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 15 }}>✓</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#4ec9a8' }}>Escrow-protected payments</span>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '12px 48px',
          marginTop: 72, paddingTop: 40, borderTop: '1px solid rgba(255,255,255,0.07)',
        }}>
          {[
            { num: '500+', label: 'Verified Providers' },
            { num: '10k+', label: 'Jobs Completed' },
            { num: '4.9★', label: 'Average Rating' },
            { num: 'All 7', label: 'Emirates Covered' },
          ].map(({ num, label }) => (
            <div key={label}>
              <span style={{ display: 'block', fontSize: 28, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.03em' }}>{num}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 3, fontWeight: 500 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
