'use client';

import { Construction } from 'lucide-react';

export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ backgroundColor: 'var(--color-primary-50)' }}
      >
        <Construction size={28} style={{ color: 'var(--color-primary)' }} />
      </div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-neutral-900)' }}>
        {title}
      </h2>
      <p className="text-sm max-w-sm" style={{ color: 'var(--color-neutral-500)' }}>
        {description ?? "This feature is in the development queue and will be available in an upcoming sprint."}
      </p>
      <span
        className="mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        In Development
      </span>
    </div>
  );
}
