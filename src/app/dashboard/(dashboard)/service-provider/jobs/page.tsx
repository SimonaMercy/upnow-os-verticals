'use client';

/**
 * Jobs — assignments land here in Sprint 3 (dispatch). Until then the page's
 * real work is the not-job-ready empty state: explain WHY it's empty and
 * route to the fix (design screen 1v).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { apiGet } from '@/lib/api';

interface JobReadyLite { jobReady: boolean; cards: Record<string, { complete: boolean }> }

export default function ServiceProviderJobsPage() {
  const [jr, setJr] = useState<JobReadyLite | null>(null);
  useEffect(() => { apiGet<JobReadyLite>('/service-provider/job-ready').then(setJr).catch(() => {}); }, []);

  const left = jr ? 5 - Object.values(jr.cards).filter(c => c.complete).length : null;
  const notReady = jr !== null && !jr.jobReady;

  return (
    <div className="p-4 sm:p-6">
      <h1 className="mb-6 text-xl font-bold" style={{ color: '#182420' }}>Jobs</h1>
      <div className="mx-auto max-w-xl rounded-2xl bg-white px-6 py-14 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: '#EEF0EF', color: '#55645B' }}>
          <Inbox size={24} />
        </span>
        {notReady ? (
          <>
            <h2 className="mt-5 text-lg font-bold" style={{ color: '#182420' }}>You&apos;re not receiving jobs yet</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed" style={{ color: '#55645B' }}>
              {left} card{left === 1 ? '' : 's'} left in Get job-ready. Finish them and bookings in your areas start arriving here.
            </p>
            <Link href="/dashboard/service-provider/job-ready"
              className="mt-6 inline-block rounded-xl px-6 py-3 text-sm font-bold text-white" style={{ background: '#0B7A4E' }}>
              Get job-ready{left !== null && ` · ${5 - left}/5`} →
            </Link>
          </>
        ) : (
          <>
            <h2 className="mt-5 text-lg font-bold" style={{ color: '#182420' }}>No jobs yet</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed" style={{ color: '#55645B' }}>
              You&apos;re job-ready — bookings in your areas will be dispatched here as they come in.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
