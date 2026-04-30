export function LandingStats() {
  return (
    <section style={{ backgroundColor: '#2e9f82', paddingBlock: 56 }}>
      <div className="container">
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '24px 16px', textAlign: 'center',
        }}>
          {[
            { num: '500+',   label: 'Verified Providers', sub: 'Checked & approved' },
            { num: '10,000+',label: 'Jobs Completed',      sub: 'Across the UAE' },
            { num: '4.9★',  label: 'Average Rating',       sub: 'From real customers' },
            { num: '7',     label: 'Emirates Covered',      sub: 'Nationwide presence' },
          ].map(({ num, label, sub }, i) => (
            <div key={label} style={{ position: 'relative' }}>
              {i > 0 && <div aria-hidden style={{ position: 'absolute', left: -8, top: '10%', width: 1, height: '80%', backgroundColor: 'rgba(255,255,255,0.20)' }} />}
              <div style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.03em', lineHeight: 1 }}>{num}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.90)', marginTop: 8 }}>{label}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
