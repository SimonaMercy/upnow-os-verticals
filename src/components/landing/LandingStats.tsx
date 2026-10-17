export function LandingStats() {
  return (
    <section style={{ background: '#047246', paddingBlock: 52 }}>
      <div className="container">
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 16, textAlign: 'center',
        }}>
          {[
            { num: '500+',   label: 'Verified Providers',  sub: 'Checked & approved' },
            { num: '10,000+',label: 'Jobs Completed',       sub: 'Across the UAE' },
            { num: '4.9★',  label: 'Average Rating',        sub: 'From real customers' },
            { num: '7',     label: 'Emirates Covered',       sub: 'Nationwide presence' },
          ].map(({ num, label, sub }, i) => (
            <div key={label} style={{ position: 'relative' }}>
              {i > 0 && (
                <div aria-hidden style={{
                  position: 'absolute', left: -8, top: '15%',
                  width: 1, height: '70%', background: 'rgba(255,255,255,0.22)',
                }} />
              )}
              <div style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1 }}>{num}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.92)', marginTop: 8 }}>{label}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 3 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
