const STEPS = {
  services: [
    { num: '01', title: 'Pick a service', desc: 'Browse 200+ services. Fixed price or quote-based.' },
    { num: '02', title: 'Get matched fast', desc: 'A verified professional is assigned within minutes.' },
    { num: '03', title: 'Track & pay safely', desc: 'Live status updates. Escrow protects your payment.' },
  ],
  spaces: [
    { num: '01', title: 'Search your way', desc: 'Filter by category, area, price, size, and more.' },
    { num: '02', title: 'View & inquire', desc: 'Book a viewing. Message the provider directly.' },
    { num: '03', title: 'Sign & move in', desc: 'Digital contracts, payments, and handover — done.' },
  ],
};

export function LandingHow() {
  return (
    <section style={{ backgroundColor: '#111110', paddingBlock: 88 }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: 60 }}>
          <h2 style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.03em', margin: '0 0 12px' }}>
            Simple, from start to finish
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.40)', maxWidth: 400, marginInline: 'auto', lineHeight: 1.6 }}>A streamlined experience on both sides of the platform</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
          {(['services', 'spaces'] as const).map((track) => (
            <div key={track}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: track === 'services' ? 'rgba(46,159,130,0.20)' : 'rgba(212,168,32,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 16 }}>{track === 'services' ? '⚡' : '🏠'}</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: track === 'services' ? '#2e9f82' : '#d4a820', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {track === 'services' ? 'For Services' : 'For Spaces'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {STEPS[track].map(({ num, title, desc }, i) => (
                  <div key={num} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: track === 'services' ? '#2e9f82' : '#d4a820',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.04em',
                      }}>{num}</div>
                      {i < 2 && <div style={{ width: 2, height: 32, backgroundColor: track === 'services' ? 'rgba(46,159,130,0.20)' : 'rgba(212,168,32,0.18)', marginBlock: 4 }} />}
                    </div>
                    <div style={{ paddingTop: 8, paddingBottom: i < 2 ? 0 : 0 }}>
                      <p style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '0 0 5px' }}>{title}</p>
                      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, margin: 0, paddingBottom: i < 2 ? 28 : 0 }}>{desc}</p>
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
