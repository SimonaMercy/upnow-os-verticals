const REVIEWS = [
  {
    initials: 'SR', name: 'Sara R.', role: 'Homeowner · Dubai Marina',
    text: 'Booked an AC technician at 9pm, he was here by 10am the next morning. Transparent pricing, no surprises. This is how all home services should work.',
    accent: '#2e9f82',
  },
  {
    initials: 'KA', name: 'Khalid A.', role: 'Business Owner · DIFC',
    text: "Listed my entire commercial floor on UpNow and had three serious inquiries within a week. The dashboard made managing documents and contracts painless.",
    accent: '#d4a820',
  },
  {
    initials: 'PM', name: 'Priya M.', role: 'Tenant · JLT',
    text: "Found a 2-bedroom I love, signed the contract, and moved in — all without a single back-and-forth email chain. UpNow handled everything in one place.",
    accent: '#7c9cd4',
  },
];

export function LandingTestimonials() {
  return (
    <section style={{ backgroundColor: '#ffffff', paddingBlock: 80 }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#2e9f82', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Reviews</p>
          <h2 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 900, color: '#1a1916', letterSpacing: '-0.03em', margin: 0 }}>
            Real people. Real results.
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {REVIEWS.map(({ initials, name, role, text, accent }) => (
            <div key={name} style={{
              background: '#fafaf8', border: '1px solid #e8e6e0', borderRadius: 20,
              padding: 32, display: 'flex', flexDirection: 'column', gap: 20,
            }}>
              {/* Quote mark */}
              <div style={{ fontSize: 48, lineHeight: 1, color: accent, fontFamily: 'Georgia, serif', opacity: 0.6 }}>&ldquo;</div>
              <p style={{ fontSize: 15, color: '#3d3b35', lineHeight: 1.7, margin: 0, flex: 1 }}>{text}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 16, borderTop: '1px solid #e8e6e0' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  backgroundColor: accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0,
                }}>{initials}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1916' }}>{name}</div>
                  <div style={{ fontSize: 12, color: '#9b9890', marginTop: 2 }}>{role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
