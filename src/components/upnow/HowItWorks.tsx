'use client';

import { useState, useRef, useEffect } from 'react';

const servicesSteps = [
  { num: '01', title: 'Choose a service', desc: 'Browse services and select exactly what you need.' },
  { num: '02', title: 'Get matched', desc: 'UpNow assigns a verified, rated professional to your job.' },
  { num: '03', title: 'Job done', desc: 'Track in real time. Rate when complete.' },
];

const spacesSteps = [
  { num: '01', title: 'Browse spaces', desc: 'Search space categories with rich filters and map view.' },
  { num: '02', title: 'Inquire and view', desc: 'Request a viewing and connect with the provider.' },
  { num: '03', title: 'Sign and move in', desc: 'Documents, payments, and handover all in one place.' },
];

export function HowItWorks() {
  const [activeTab, setActiveTab] = useState<'services' | 'spaces'>('services');
  const [animating, setAnimating] = useState(false);
  const steps = activeTab === 'services' ? servicesSteps : spacesSteps;
  const prevTab = useRef(activeTab);

  useEffect(() => {
    if (prevTab.current !== activeTab) {
      setAnimating(true);
      const t = setTimeout(() => setAnimating(false), 350);
      prevTab.current = activeTab;
      return () => clearTimeout(t);
    }
  }, [activeTab]);

  return (
    <section
      style={{
        background: 'linear-gradient(180deg, var(--base-100) 0%, var(--white) 100%)',
        paddingBlock: 80,
      }}
    >
      <div className="container">
        <div className="text-center">
          <h2 className="font-bold" style={{ fontSize: 42, color: 'var(--neutral-900)', letterSpacing: '-0.02em' }}>
            How it works
          </h2>
          <p className="mt-3" style={{ fontSize: 18, color: 'var(--neutral-500)', maxWidth: 480, marginInline: 'auto', lineHeight: 1.6 }}>
            A simple flow for booking services or finding your next space
          </p>
        </div>

        {/* Toggle */}
        <div className="flex justify-center mt-8">
          <div
            className="relative flex p-1 rounded-full"
            style={{ backgroundColor: 'var(--base-200)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)' }}
          >
            {(['services', 'spaces'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="relative z-10 px-6 py-2.5 rounded-full font-[600] text-sm transition-all duration-300 cursor-pointer"
                style={{
                  color: activeTab === tab ? 'var(--white)' : 'var(--neutral-600)',
                  backgroundColor: activeTab === tab ? 'var(--primary)' : 'transparent',
                  boxShadow: activeTab === tab ? '0 2px 8px rgba(4,114,70,0.3)' : 'none',
                }}
              >
                {tab === 'services' ? 'For Services' : 'For Spaces'}
              </button>
            ))}
          </div>
        </div>

        {/* Steps */}
        <div
          className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8"
          style={{
            opacity: animating ? 0 : 1,
            transform: animating ? 'translateY(12px)' : 'translateY(0)',
            transition: 'opacity 0.35s ease, transform 0.35s ease',
          }}
        >
          {steps.map((step, i) => (
            <div
              key={step.num + activeTab}
              className="relative bg-white"
              style={{
                borderRadius: 20,
                padding: 32,
                boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 6px 24px -4px rgba(0,0,0,0.06)',
                border: '1px solid var(--base-200)',
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.04), 0 12px 32px -4px rgba(4,114,70,0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04), 0 6px 24px -4px rgba(0,0,0,0.06)';
              }}
            >
              <div
                className="flex items-center justify-center font-bold text-sm"
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--gold) 0%, #c8a000 100%)',
                  color: 'var(--white)',
                  boxShadow: '0 2px 8px rgba(196,160,0,0.25)',
                  fontSize: 13, letterSpacing: '0.04em',
                }}
              >
                {step.num}
              </div>
              <p className="font-semibold mt-5" style={{ color: 'var(--neutral-900)', fontSize: 18 }}>{step.title}</p>
              <p className="mt-3" style={{ color: 'var(--neutral-500)', fontSize: 14, lineHeight: 1.7 }}>{step.desc}</p>

              {i < 2 && (
                <div
                  className="hidden md:block absolute"
                  style={{
                    top: 50, right: -20, width: 40, height: 2,
                    background: 'linear-gradient(90deg, var(--base-200) 0%, transparent 100%)',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
