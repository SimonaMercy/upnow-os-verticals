'use client';

/**
 * Jobs — assignments land here in Sprint 3 (dispatch). Until then the page's
 * real work is the not-job-ready empty state: explain WHY it's empty and
 * route to the fix (design screen 1v).
 *
 * Styled to design 2a (SP live dashboard vocabulary): Schibsted Grotesk,
 * #F5F7F4 canvas, #E4E7E2 / radius-14 card — one system with the SP portal.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Schibsted_Grotesk } from 'next/font/google';
import { Inbox } from 'lucide-react';
import { apiGet } from '@/lib/api';

const grotesk = Schibsted_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

interface JobReadyLite { jobReady: boolean; cards: Record<string, { complete: boolean }> }

export default function ServiceProviderJobsPage() {
  const [jr, setJr] = useState<JobReadyLite | null>(null);
  useEffect(() => { apiGet<JobReadyLite>('/service-provider/job-ready').then(setJr).catch(() => {}); }, []);

  const left = jr ? 5 - Object.values(jr.cards).filter(c => c.complete).length : null;
  const notReady = jr !== null && !jr.jobReady;

  return (
    <div className={grotesk.className} style={{ background: '#F5F7F4', minHeight: '100%', color: '#182420' }}>
      <div className="max-w-5xl mx-auto" style={{ padding: '26px 20px 40px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.015em', color: '#182420', marginBottom: 22 }}>Jobs</h1>
        <div
          className="mx-auto text-center"
          style={{ maxWidth: 560, background: '#fff', border: '1px solid #E4E7E2', borderRadius: 14, padding: '56px 24px' }}
        >
          <span className="mx-auto flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, background: '#E9F4EE', color: '#0B7A4E' }}>
            <Inbox size={24} />
          </span>
          {notReady ? (
            <>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20, color: '#182420' }}>You&apos;re not receiving jobs yet</h2>
              <p className="mx-auto" style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 7, maxWidth: 360, color: '#55645B' }}>
                {left} card{left === 1 ? '' : 's'} left in Get job-ready. Finish them and bookings in your areas start arriving here.
              </p>
              <Link
                href="/dashboard/service-provider/settings?tab=rules"
                className="inline-block"
                style={{ marginTop: 24, borderRadius: 11, padding: '12px 22px', fontSize: 13.5, fontWeight: 600, color: '#fff', background: '#0B7A4E', boxShadow: '0 5px 14px -7px rgba(11,122,78,.55)' }}
              >
                Get job-ready{left !== null && ` · ${5 - left}/5`} →
              </Link>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20, color: '#182420' }}>No jobs yet</h2>
              <p className="mx-auto" style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 7, maxWidth: 360, color: '#55645B' }}>
                You&apos;re job-ready — bookings in your areas will be dispatched here as they come in.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
