'use client';

import { HelpCircle } from 'lucide-react';

export default function CustomerHelpPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div
          className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center"
          style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, white)' }}
        >
          <HelpCircle size={28} style={{ color: 'var(--color-primary)' }} />
        </div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-neutral-900)' }}>
          Help Center
        </h1>
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--color-neutral-500)' }}>
          FAQs, guides, and a direct line to our support team.
        </p>
        <p className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>
          In the meantime, email{' '}
          <a href="mailto:support@upnow.ae" className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            support@upnow.ae
          </a>
          .
        </p>
        <p className="text-xs mt-5 inline-block px-3 py-1 rounded-full font-semibold uppercase tracking-wide"
           style={{ background: 'var(--color-base-100, #fafafa)', color: 'var(--color-neutral-400)', border: '1px solid var(--color-base-200)' }}>
          Coming soon
        </p>
      </div>
    </div>
  );
}
