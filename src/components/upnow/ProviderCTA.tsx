import Link from 'next/link';
import { Briefcase, Building2 } from 'lucide-react';

const cards = [
  {
    icon: Briefcase,
    title: 'Offer Services',
    desc: 'Apply to list your service business and get matched with customers across the UAE.',
    href: '/providers/services',
    cta: 'Submit an application',
  },
  {
    icon: Building2,
    title: 'List Your Space',
    desc: 'Submit an application to publish apartments, offices, or warehouses and manage everything in one dashboard.',
    href: '/providers/spaces',
    cta: 'Submit an application',
  },
];

export function ProviderCTA() {
  return (
    <section
      style={{
        background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
        paddingBlock: 96,
      }}
    >
      <div className="container text-center">
        <h2 className="font-bold text-white" style={{ fontSize: 42, letterSpacing: '-0.02em' }}>
          Grow your business with UpNow
        </h2>
        <p className="mt-2" style={{ color: 'rgba(255,255,255,0.8)', fontSize: 20 }}>
          Join providers expanding their services and spaces
        </p>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 text-start">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="flex flex-col"
                style={{
                  background: 'rgba(255,255,255,0.10)',
                  border: '1px solid rgba(255,255,255,0.20)',
                  borderRadius: 20,
                  padding: 32,
                }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{ width: 48, height: 48, backgroundColor: 'rgba(255,255,255,0.20)', borderRadius: '50%' }}
                >
                  <Icon size={22} className="text-white" />
                </div>
                <h3 className="font-bold text-white mt-4" style={{ fontSize: 22 }}>{card.title}</h3>
                <p className="text-sm mt-2 flex-1" style={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.6 }}>
                  {card.desc}
                </p>
                <Link
                  href={card.href}
                  className="inline-block mt-6 rounded-full px-6 py-3 font-[500] text-sm transition-opacity hover:opacity-90 self-start"
                  style={{ backgroundColor: 'var(--white)', color: 'var(--primary)' }}
                >
                  {card.cta}
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
