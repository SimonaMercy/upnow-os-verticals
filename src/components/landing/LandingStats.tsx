const STATS = [
  { num: '500+',    label: 'Verified Providers',  desc: 'Checked, approved, and rated' },
  { num: '10,000+', label: 'Jobs Completed',       desc: 'Across the UAE' },
  { num: '4.9★',   label: 'Average Rating',        desc: 'From verified customers' },
  { num: 'All 7',  label: 'Emirates Covered',      desc: 'Available nationwide' },
];

export function LandingStats() {
  return (
    <section
      style={{
        backgroundColor: '#1a1916',
        paddingBlock: 72,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative glow */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 700,
          height: 300,
          background:
            'radial-gradient(ellipse at center, rgba(46,159,130,0.08) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div className="container" style={{ position: 'relative', zIndex: 1 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '32px 24px',
            textAlign: 'center',
          }}
        >
          {STATS.map(({ num, label, desc }, i) => (
            <div key={label} style={{ position: 'relative' }}>
              {/* Vertical divider between items on desktop */}
              {i > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: -12,
                    top: '10%',
                    width: 1,
                    height: '80%',
                    backgroundColor: 'rgba(255,255,255,0.07)',
                  }}
                />
              )}
              <div
                style={{
                  fontSize: 'clamp(30px, 4vw, 46px)',
                  fontWeight: 800,
                  color: '#2e9f82',
                  letterSpacing: '-0.03em',
                  lineHeight: 1,
                }}
              >
                {num}
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#ffffff',
                  marginTop: 10,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.40)',
                  marginTop: 4,
                }}
              >
                {desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
