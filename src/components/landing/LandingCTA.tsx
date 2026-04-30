import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function LandingCTA() {
  return (
    <section style={{
      backgroundColor: '#0d0d0b', paddingBlock: 120,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Giant background text */}
      <div aria-hidden style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        fontSize: 'clamp(100px, 22vw, 240px)',
        fontWeight: 900, letterSpacing: '-0.05em',
        color: 'rgba(255,255,255,0.025)',
        whiteSpace: 'nowrap', pointerEvents: 'none',
        userSelect: 'none', lineHeight: 1,
      }}>
        GROW
      </div>

      <div aria-hidden style={{ position: 'absolute', top: '30%', left: '15%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(46,159,130,0.09) 0%, transparent 60%)', pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: '10%', right: '10%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(212,168,32,0.06) 0%, transparent 60%)', pointerEvents: 'none' }} />

      <div className="container" style={{ position: 'relative', zIndex: 1 }}>

        <div style={{ maxWidth: 640, marginBottom: 64 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#2e9f82', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>For Businesses</p>
          <h2 style={{ fontSize: 'clamp(36px, 5vw, 64px)', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.03em', lineHeight: 1.05, margin: '0 0 20px' }}>
            Grow your business<br />
            <span style={{ color: '#2e9f82' }}>with UpNow.</span>
          </h2>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.50)', lineHeight: 1.65, margin: 0 }}>
            Thousands of customers are already on the platform. Join them — as a service provider or space provider — and manage everything from one dashboard.
          </p>
        </div>

        {/* Two cards side-by-side */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, maxWidth: 760 }}>
          {/* Service provider card */}
          <div style={{
            padding: 36, borderRadius: 20,
            background: 'rgba(46,159,130,0.08)', border: '1px solid rgba(46,159,130,0.22)',
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ fontSize: 36 }}>🔧</div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#2e9f82', letterSpacing: '0.10em', textTransform: 'uppercase', margin: '0 0 8px' }}>Service Providers</p>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', margin: '0 0 10px', letterSpacing: '-0.02em' }}>Offer your services</h3>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: 0 }}>
                Get matched with customers across the UAE. Manage bookings, technicians, and payments from one dashboard.
              </p>
            </div>
            <Link href="/providers/services" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 'auto',
              backgroundColor: '#2e9f82', color: '#fff', fontWeight: 700, fontSize: 14,
              padding: '14px 24px', borderRadius: 12, textDecoration: 'none', alignSelf: 'flex-start',
            }}>
              Apply as a Provider <ArrowRight size={14} />
            </Link>
          </div>

          {/* Space provider card */}
          <div style={{
            padding: 36, borderRadius: 20,
            background: 'rgba(212,168,32,0.07)', border: '1px solid rgba(212,168,32,0.20)',
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ fontSize: 36 }}>🏢</div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#d4a820', letterSpacing: '0.10em', textTransform: 'uppercase', margin: '0 0 8px' }}>Space Providers</p>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: '#ffffff', margin: '0 0 10px', letterSpacing: '-0.02em' }}>List your property</h3>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: 0 }}>
                Publish apartments, offices, and warehouses. Handle inquiries, contracts, and renewals — fully digitised.
              </p>
            </div>
            <Link href="/providers/spaces" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 'auto',
              backgroundColor: '#d4a820', color: '#fff', fontWeight: 700, fontSize: 14,
              padding: '14px 24px', borderRadius: 12, textDecoration: 'none', alignSelf: 'flex-start',
            }}>
              List Your Property <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
