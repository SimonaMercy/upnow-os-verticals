import Link from 'next/link';
import { Zap, ShieldCheck, MapPin, Star, Clock } from 'lucide-react';

export function LandingBento() {
  return (
    <section style={{ backgroundColor: '#fafaf8', paddingBlock: 80 }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#2e9f82', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>
            Why UpNow
          </p>
          <h2 style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 900, color: '#1a1916', letterSpacing: '-0.03em', margin: 0 }}>
            Built differently.
          </h2>
        </div>

        {/* Bento grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gridTemplateRows: 'auto auto', gap: 16 }}>

          {/* Cell 1 — Large, 7 cols */}
          <div style={{
            gridColumn: 'span 7', padding: 36, borderRadius: 20,
            background: 'linear-gradient(145deg, #0d2a22 0%, #1a4a3a 100%)',
            border: '1px solid rgba(46,159,130,0.20)',
            display: 'flex', flexDirection: 'column', gap: 16, minHeight: 220,
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(46,159,130,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={24} color="#2e9f82" strokeWidth={1.8} />
            </div>
            <div>
              <h3 style={{ fontSize: 24, fontWeight: 800, color: '#ffffff', margin: '0 0 8px', letterSpacing: '-0.02em' }}>Instant booking</h3>
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: 0, maxWidth: 340 }}>
                Book a verified professional in minutes. Real-time availability, no waiting for callbacks.
              </p>
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
              {['AC Service', 'Cleaning', 'Plumbing'].map(s => (
                <span key={s} style={{
                  fontSize: 12, fontWeight: 600, color: '#2e9f82',
                  background: 'rgba(46,159,130,0.15)', border: '1px solid rgba(46,159,130,0.25)',
                  borderRadius: 9999, padding: '5px 12px',
                }}>{s}</span>
              ))}
            </div>
          </div>

          {/* Cell 2 — 5 cols */}
          <div style={{
            gridColumn: 'span 5', padding: 32, borderRadius: 20,
            background: '#ffffff', border: '1px solid #e8e6e0',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#d8f2e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={24} color="#2e9f82" strokeWidth={1.8} />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1a1916', margin: 0, letterSpacing: '-0.02em' }}>Escrow-protected payments</h3>
            <p style={{ fontSize: 14, color: '#6b6860', lineHeight: 1.6, margin: 0 }}>
              Your money is held safely until the job is confirmed complete. Zero risk.
            </p>
          </div>

          {/* Cell 3 — 4 cols */}
          <div style={{
            gridColumn: 'span 4', padding: 32, borderRadius: 20,
            background: '#1a1916', border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(212,168,32,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MapPin size={24} color="#d4a820" strokeWidth={1.8} />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', margin: 0, letterSpacing: '-0.02em' }}>All 7 Emirates</h3>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.50)', lineHeight: 1.6, margin: 0 }}>
              From Dubai to Fujairah — services and spaces wherever you are.
            </p>
          </div>

          {/* Cell 4 — 4 cols */}
          <div style={{
            gridColumn: 'span 4', padding: 32, borderRadius: 20,
            background: 'linear-gradient(145deg, #2d1f02 0%, #4a3505 100%)',
            border: '1px solid rgba(212,168,32,0.18)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(212,168,32,0.20)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Star size={24} color="#d4a820" strokeWidth={1.8} />
            </div>
            <div style={{ fontSize: 42, fontWeight: 900, color: '#d4a820', letterSpacing: '-0.03em', lineHeight: 1 }}>4.9★</div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: 0 }}>Average provider rating from 10,000+ verified reviews</p>
          </div>

          {/* Cell 5 — 4 cols */}
          <div style={{
            gridColumn: 'span 4', padding: 32, borderRadius: 20,
            background: '#f0faf6', border: '1px solid #c8ead8',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#d8f2e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={24} color="#2e9f82" strokeWidth={1.8} />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1a1916', margin: 0, letterSpacing: '-0.02em' }}>Real-time tracking</h3>
            <p style={{ fontSize: 14, color: '#4f4c44', lineHeight: 1.6, margin: 0 }}>
              Watch your job live — from assignment to completion, on your phone.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
