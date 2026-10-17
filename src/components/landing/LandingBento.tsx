import { Zap, ShieldCheck, MapPin, Star, Clock } from 'lucide-react';

const FEATURES = [
  {
    Icon: Zap,
    title: 'Instant booking',
    desc: 'Book a verified professional in minutes. Real-time availability, no waiting for callbacks.',
    accent: '#047246',
    bg: '#eef7f2',
    border: '#d8efe3',
    iconBg: '#d8efe3',
    span: 7,
    tags: ['AC Service', 'Cleaning', 'Plumbing'],
  },
  {
    Icon: ShieldCheck,
    title: 'Escrow-protected',
    desc: 'Your money is held safely until the job is confirmed complete. Zero risk.',
    accent: '#0ea5e9',
    bg: '#f0f9ff',
    border: '#bae6fd',
    iconBg: '#bae6fd',
    span: 5,
  },
  {
    Icon: MapPin,
    title: 'All 7 Emirates',
    desc: 'From Dubai to Fujairah — services and spaces wherever you are.',
    accent: '#d4a820',
    bg: '#fffbeb',
    border: '#fde68a',
    iconBg: '#fde68a',
    span: 4,
  },
  {
    Icon: Star,
    title: '4.9★ Average Rating',
    desc: 'Verified reviews from 10,000+ completed jobs.',
    accent: '#047246',
    bg: '#eef7f2',
    border: '#d8efe3',
    iconBg: '#d8efe3',
    span: 4,
  },
  {
    Icon: Clock,
    title: 'Real-time tracking',
    desc: 'Watch your job live — from assignment to completion, on your phone.',
    accent: '#7c3aed',
    bg: '#f5f3ff',
    border: '#ddd6fe',
    iconBg: '#ddd6fe',
    span: 4,
  },
];

export function LandingBento() {
  return (
    <section style={{ background: '#ffffff', paddingBlock: 80 }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#047246', letterSpacing: '0.10em', textTransform: 'uppercase', margin: '0 0 10px' }}>Why UpNow</p>
          <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 900, color: '#14201a', letterSpacing: '-0.025em', margin: 0, lineHeight: 1.1 }}>
            Built differently.
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>
          {FEATURES.map(({ Icon, title, desc, accent, bg, border, iconBg, span, tags }) => (
            <div key={title} style={{
              gridColumn: `span ${span}`,
              padding: 28, borderRadius: 18,
              background: bg, border: `1px solid ${border}`,
              display: 'flex', flexDirection: 'column', gap: 12, minHeight: 180,
            }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={22} color={accent} strokeWidth={1.8} aria-hidden />
              </div>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: '#14201a', margin: '0 0 6px', letterSpacing: '-0.015em' }}>{title}</h3>
                <p style={{ fontSize: 13, color: '#5f6b63', lineHeight: 1.6, margin: 0 }}>{desc}</p>
              </div>
              {tags && (
                <div style={{ marginTop: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {tags.map(t => (
                    <span key={t} style={{
                      fontSize: 11, fontWeight: 700, color: accent,
                      background: '#fff', border: `1px solid ${border}`,
                      borderRadius: 9999, padding: '4px 10px',
                    }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
