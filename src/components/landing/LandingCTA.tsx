import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const CARDS = [
  {
    emoji: '🔧',
    eyebrow: 'Service Providers',
    title: 'Offer your services',
    desc: 'Get matched with customers across the UAE. Manage bookings, technicians, and payments from one dashboard.',
    cta: 'Apply as a Provider',
    href: '/providers/services',
    bg: '#eef7f2', border: '#d8efe3',
    btnBg: '#047246', eyebrowColor: '#0f4f36',
  },
  {
    emoji: '🏢',
    eyebrow: 'Space Providers',
    title: 'List your property',
    desc: 'Publish apartments, offices, and warehouses. Handle inquiries, contracts, and renewals — fully digitised.',
    cta: 'List Your Property',
    href: '/providers/spaces',
    bg: '#fffbeb', border: '#fde68a',
    btnBg: '#d4a820', eyebrowColor: '#92400e',
  },
];

export function LandingCTA() {
  return (
    <section style={{ background: '#f6f8f6', paddingBlock: 80 }}>
      <div className="container">

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#047246', letterSpacing: '0.10em', textTransform: 'uppercase', margin: '0 0 10px' }}>For Businesses</p>
          <h2 style={{ fontSize: 'clamp(24px, 3vw, 40px)', fontWeight: 900, color: '#14201a', letterSpacing: '-0.025em', margin: '0 0 10px', lineHeight: 1.1 }}>
            Grow your business with UpNow.
          </h2>
          <p style={{ fontSize: 15, color: '#5f6b63', maxWidth: 480, lineHeight: 1.65, margin: 0 }}>
            Thousands of customers are already on the platform. Join as a service provider or space provider — and manage everything from one dashboard.
          </p>
        </div>

        {/* Two cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, maxWidth: 720 }}>
          {CARDS.map(({ emoji, eyebrow, title, desc, cta, href, bg, border, btnBg, eyebrowColor }) => (
            <div key={title} style={{
              background: bg, border: `1px solid ${border}`,
              borderRadius: 20, padding: 28,
              display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              <div style={{ fontSize: 32 }}>{emoji}</div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: eyebrowColor, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 6px' }}>{eyebrow}</p>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: '#14201a', margin: '0 0 8px', letterSpacing: '-0.015em' }}>{title}</h3>
                <p style={{ fontSize: 13, color: '#5f6b63', lineHeight: 1.65, margin: 0 }}>{desc}</p>
              </div>
              <Link href={href} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 'auto',
                background: btnBg, color: '#fff', fontWeight: 700, fontSize: 13,
                padding: '12px 20px', borderRadius: 12, textDecoration: 'none',
                alignSelf: 'flex-start',
              }}>
                {cta} <ArrowRight size={13} aria-hidden />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
