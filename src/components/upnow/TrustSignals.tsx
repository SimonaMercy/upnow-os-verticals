import { ShieldCheck, Briefcase, Lock, Star } from 'lucide-react';

const items = [
  { icon: ShieldCheck, stat: '500+',    label: 'Verified Providers', desc: 'Checked, approved, and rated' },
  { icon: Briefcase,  stat: '10,000+',  label: 'Jobs Completed',     desc: 'Across the UAE' },
  { icon: Lock,       stat: '100%',     label: 'Secure Payments',    desc: 'AED payments, protected' },
  { icon: Star,       stat: '4.9★',    label: 'Average Rating',     desc: 'From verified customers' },
];

export function TrustSignals() {
  return (
    <section style={{ backgroundColor: 'var(--base-100)', paddingBlock: 64 }}>
      <div className="container">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label}>
                <div
                  className="mx-auto flex items-center justify-center"
                  style={{ width: 52, height: 52, backgroundColor: 'var(--primary-light)', borderRadius: '50%' }}
                >
                  <Icon size={24} style={{ color: 'var(--primary)' }} />
                </div>
                <p className="font-bold mt-3" style={{ fontSize: 40, color: 'var(--primary)', letterSpacing: '-0.02em' }}>
                  {item.stat}
                </p>
                <p className="font-semibold mt-1" style={{ color: 'var(--neutral-900)', fontSize: 16 }}>
                  {item.label}
                </p>
                <p className="mt-1" style={{ color: 'var(--neutral-500)', fontSize: 15 }}>
                  {item.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
