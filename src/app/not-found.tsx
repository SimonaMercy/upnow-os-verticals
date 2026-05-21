'use client';

import Link from 'next/link';
import { Construction } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-6" style={{ backgroundColor: 'var(--color-base-50)' }}>
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ backgroundColor: 'var(--color-primary-50)' }}
      >
        <Construction size={28} style={{ color: 'var(--color-primary)' }} />
      </div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-neutral-900)' }}>
        In Development
      </h1>
      <p className="text-sm max-w-sm mb-6" style={{ color: 'var(--color-neutral-500)' }}>
        This page is in the development queue and will be available in an upcoming sprint.
      </p>
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium mb-8"
        style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Coming Soon
      </span>
      <Link
        href="/dashboard"
        className="text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
