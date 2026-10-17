const TRACKS = {
  services: {
    label: 'For Services',
    color: '#047246',
    bg: '#eef7f2',
    border: '#d8efe3',
    emoji: '⚡',
    steps: [
      { num: '01', title: 'Pick a service',      desc: 'Browse 200+ services with fixed price or inspection-based quotes.' },
      { num: '02', title: 'Get matched fast',    desc: 'A verified professional is assigned within minutes of payment.' },
      { num: '03', title: 'Track & pay safely',  desc: 'Live status updates. Escrow holds your payment until job is done.' },
    ],
  },
  spaces: {
    label: 'For Spaces',
    color: '#d4a820',
    bg: '#fffbeb',
    border: '#fde68a',
    emoji: '🏠',
    steps: [
      { num: '01', title: 'Search your way',     desc: 'Filter by category, area, price, size and availability.' },
      { num: '02', title: 'View & inquire',      desc: 'Book a viewing or message the rental provider directly through the platform.' },
      { num: '03', title: 'Sign & move in',      desc: 'Digital contract, payment, and handover — all in one place.' },
    ],
  },
};

export function LandingHow() {
  return (
    <section style={{ background: '#ffffff', paddingBlock: 80 }}>
      <div className="container">

        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#047246', letterSpacing: '0.10em', textTransform: 'uppercase', margin: '0 0 10px' }}>How it works</p>
          <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 900, color: '#14201a', letterSpacing: '-0.025em', margin: '0 0 10px', lineHeight: 1.1 }}>
            Simple, from start to finish.
          </h2>
          <p style={{ fontSize: 15, color: '#5f6b63', maxWidth: 400, marginInline: 'auto', lineHeight: 1.6, margin: '0 auto' }}>
            A streamlined experience — whether you need a service or a space.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          {Object.values(TRACKS).map(({ label, color, bg, border, emoji, steps }) => (
            <div key={label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 20, padding: '28px 28px 32px' }}>
              {/* Track header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fff', border: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                  {emoji}
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
              </div>

              {/* Steps */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {steps.map(({ num, title, desc }, i) => (
                  <div key={num} style={{ display: 'flex', gap: 16 }}>
                    {/* Number + connector */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: color, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 11, fontWeight: 800,
                        color: '#fff', letterSpacing: '0.03em', flexShrink: 0,
                      }}>{num}</div>
                      {i < 2 && <div style={{ width: 2, height: 28, background: `${color}30`, marginBlock: 4 }} />}
                    </div>
                    {/* Text */}
                    <div style={{ paddingTop: 6, paddingBottom: i < 2 ? 0 : 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#14201a', margin: '0 0 4px' }}>{title}</p>
                      <p style={{ fontSize: 13, color: '#5f6b63', lineHeight: 1.6, margin: 0, paddingBottom: i < 2 ? 24 : 0 }}>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
