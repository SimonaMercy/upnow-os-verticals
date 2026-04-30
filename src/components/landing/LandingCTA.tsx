import Link from 'next/link';
import { Briefcase, Building2, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const CARDS = [
  {
    Icon: Briefcase,
    eyebrow: 'Service Providers',
    title: 'Offer your expertise to thousands of customers',
    desc: 'Apply to list your service business and get matched with verified customers across the UAE.',
    href: '/providers/services',
    cta: 'Apply as a Provider',
  },
  {
    Icon: Building2,
    eyebrow: 'Space Providers',
    title: 'List properties and manage everything in one dashboard',
    desc: 'Publish apartments, offices, or warehouses and handle bookings, contracts, and renewals seamlessly.',
    href: '/providers/spaces',
    cta: 'List Your Property',
  },
];

export function LandingCTA() {
  return (
    <section
      style={{
        background: 'linear-gradient(145deg, #1a4a3a 0%, #1a5a4a 40%, #2e9f82 100%)',
        paddingBlock: 96,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative ring — top right */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '-30%',
          right: '-8%',
          width: 560,
          height: 560,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.08)',
          pointerEvents: 'none',
        }}
      />
      {/* Decorative ring — bottom left */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: '-25%',
          left: '5%',
          width: 380,
          height: 380,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.06)',
          pointerEvents: 'none',
        }}
      />

      <div
        className="container"
        style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}
      >
        <h2
          style={{
            fontSize: 'clamp(28px, 3.8vw, 46px)',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.025em',
            margin: '0 0 12px',
          }}
        >
          Grow your business with UpNow
        </h2>
        <p
          style={{
            fontSize: 18,
            color: 'rgba(255,255,255,0.72)',
            marginBottom: 52,
          }}
        >
          Join providers already expanding across the UAE
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
            maxWidth: 820,
            marginInline: 'auto',
            textAlign: 'start',
          }}
        >
          {CARDS.map(({ Icon, eyebrow, title, desc, href, cta }) => (
            <CTACard
              key={eyebrow}
              Icon={Icon}
              eyebrow={eyebrow}
              title={title}
              desc={desc}
              href={href}
              cta={cta}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CTACard({
  Icon,
  eyebrow,
  title,
  desc,
  href,
  cta,
}: {
  Icon: LucideIcon;
  eyebrow: string;
  title: string;
  desc: string;
  href: string;
  cta: string;
}) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 20,
        padding: 32,
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.14)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <Icon size={22} color="rgba(255,255,255,0.90)" strokeWidth={1.8} />
      </div>

      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.55)',
          marginBottom: 10,
        }}
      >
        {eyebrow}
      </p>

      <h3
        style={{
          fontSize: 19,
          fontWeight: 700,
          color: '#ffffff',
          margin: '0 0 10px',
          lineHeight: 1.35,
        }}
      >
        {title}
      </h3>

      <p
        style={{
          fontSize: 14,
          color: 'rgba(255,255,255,0.65)',
          lineHeight: 1.65,
          flex: 1,
          margin: '0 0 24px',
        }}
      >
        {desc}
      </p>

      <Link
        href={href}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          backgroundColor: '#ffffff',
          color: '#1a4a3a',
          fontWeight: 700,
          fontSize: 14,
          padding: '12px 22px',
          borderRadius: 12,
          textDecoration: 'none',
          alignSelf: 'flex-start',
        }}
      >
        {cta}
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
