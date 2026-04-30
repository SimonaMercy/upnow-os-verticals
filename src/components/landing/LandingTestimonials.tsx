const REVIEWS = [
  {
    initials: 'SR', name: 'Sara R.',    role: 'Homeowner · Dubai Marina',
    text: 'Booked an AC technician at 9pm, he was here by 10am the next morning. Transparent pricing, no surprises. This is how all home services should work.',
    accentBg: '#f0faf6', accentBorder: '#d8f2e8', avatarBg: '#2e9f82',
  },
  {
    initials: 'KA', name: 'Khalid A.', role: 'Business Owner · DIFC',
    text: 'Listed my commercial floor on UpNow and had three serious inquiries within a week. Managing documents and contracts through the dashboard was painless.',
    accentBg: '#fffbeb', accentBorder: '#fde68a', avatarBg: '#d4a820',
  },
  {
    initials: 'PM', name: 'Priya M.',  role: 'Tenant · JLT',
    text: 'Found a 2-bedroom I love, signed the contract, and moved in — all without a single back-and-forth email chain. UpNow handled everything in one place.',
    accentBg: '#f0f9ff', accentBorder: '#bae6fd', avatarBg: '#0ea5e9',
  },
];

export function LandingTestimonials() {
  return (
    <section style={{ background: '#fafaf8', paddingBlock: 80 }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#2e9f82', letterSpacing: '0.10em', textTransform: 'uppercase', margin: '0 0 10px' }}>Reviews</p>
          <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 900, color: '#1a1916', letterSpacing: '-0.025em', margin: 0, lineHeight: 1.1 }}>
            Real people. Real results.
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {REVIEWS.map(({ initials, name, role, text, accentBg, accentBorder, avatarBg }) => (
            <div key={name} style={{
              background: '#ffffff', border: '1px solid #e8e6e0', borderRadius: 20, padding: 28,
              display: 'flex', flexDirection: 'column', gap: 16,
              boxShadow: '0 2px 8px rgba(15,23,42,0.04)',
            }}>
              {/* Top accent stripe */}
              <div style={{ height: 4, background: accentBg, border: `1px solid ${accentBorder}`, borderRadius: 9999, marginBottom: 4 }} />
              {/* Quote */}
              <p style={{ fontSize: 15, color: '#3d3b35', lineHeight: 1.7, margin: 0, flex: 1 }}>&ldquo;{text}&rdquo;</p>
              {/* Author */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 14, borderTop: '1px solid #e8e6e0' }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%', background: avatarBg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0,
                }}>{initials}</div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: '#1a1916', margin: 0 }}>{name}</p>
                  <p style={{ fontSize: 11, color: '#9b9890', margin: '2px 0 0' }}>{role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
