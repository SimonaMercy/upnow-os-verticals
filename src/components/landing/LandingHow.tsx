const SERVICES_STEPS = [
  {
    num: '01',
    title: 'Choose a service',
    desc: 'Browse 200+ services and select exactly what you need.',
  },
  {
    num: '02',
    title: 'Get matched',
    desc: 'A verified, rated professional is assigned to your job.',
  },
  {
    num: '03',
    title: 'Job done',
    desc: 'Track in real time. Pay securely. Rate when complete.',
  },
];

const SPACES_STEPS = [
  {
    num: '01',
    title: 'Browse spaces',
    desc: 'Search with filters, map view, and rich detail pages.',
  },
  {
    num: '02',
    title: 'Inquire & view',
    desc: 'Request a viewing and connect directly with the provider.',
  },
  {
    num: '03',
    title: 'Sign & move in',
    desc: 'Contracts, payments, and handover — all in one place.',
  },
];

type Step = { num: string; title: string; desc: string };

function HowColumn({
  label,
  emoji,
  steps,
  accentColor,
}: {
  label: string;
  emoji: string;
  steps: Step[];
  accentColor: string;
}) {
  return (
    <div
      style={{
        padding: 32,
        borderRadius: 20,
        backgroundColor: '#fafaf8',
        border: '1px solid #e8e6e0',
      }}
    >
      <p
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 14,
          fontWeight: 700,
          color: accentColor,
          marginBottom: 28,
        }}
      >
        {emoji}&nbsp;{label}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {steps.map(({ num, title, desc }, i) => (
          <div key={num} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {/* Step indicator + connector line */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  backgroundColor: accentColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 800,
                  color: '#fff',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                }}
              >
                {num}
              </div>
              {i < steps.length - 1 && (
                <div
                  style={{
                    width: 2,
                    height: 36,
                    backgroundColor: `${accentColor}25`,
                    marginTop: 4,
                    marginBottom: 4,
                  }}
                />
              )}
            </div>

            {/* Content */}
            <div style={{ paddingTop: 7, paddingBottom: i < steps.length - 1 ? 36 : 0 }}>
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#1a1916',
                  margin: '0 0 4px',
                }}
              >
                {title}
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: '#6b6860',
                  lineHeight: 1.65,
                  margin: 0,
                }}
              >
                {desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingHow() {
  return (
    <section style={{ backgroundColor: '#ffffff', paddingBlock: 80 }}>
      <div className="container">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <h2
            style={{
              fontSize: 'clamp(28px, 3.5vw, 42px)',
              fontWeight: 800,
              color: '#1a1916',
              letterSpacing: '-0.025em',
              margin: '0 0 12px',
            }}
          >
            Simple, from start to finish
          </h2>
          <p
            style={{
              fontSize: 17,
              color: '#6b6860',
              maxWidth: 420,
              marginInline: 'auto',
              lineHeight: 1.6,
            }}
          >
            A streamlined flow for every type of customer
          </p>
        </div>

        {/* Two-column layout — collapses to 1 col on mobile */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 20,
          }}
        >
          <HowColumn
            label="For Services"
            emoji="🔧"
            steps={SERVICES_STEPS}
            accentColor="#2e9f82"
          />
          <HowColumn
            label="For Spaces"
            emoji="🏠"
            steps={SPACES_STEPS}
            accentColor="#d4a820"
          />
        </div>
      </div>
    </section>
  );
}
