/**
 * SP Operations — four booking pipeline trackers (Requests · Quotes · Active
 * Jobs · Closure), each a stage board, mirroring the RP /operations page. Pure
 * tracker: cards open the job's detail page where the work happens. Selected
 * tab + view persist in the URL (?tab=&view=). See SpOperationsPipelines for
 * the data + stage model.
 *
 * This is the SP's only job board — the old /jobs list was a permanently-empty
 * placeholder and now redirects here, so its not-job-ready nudge lives here too:
 * an empty board otherwise reads as "no demand" when the real reason is that the
 * provider isn't dispatchable yet.
 */
'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import SpOperationsPipelines from '@/components/upnow/SpOperationsPipelines';

interface JobReadyLite { jobReady: boolean; cards: Record<string, { complete: boolean }> }

/** Explains an empty board when the provider isn't dispatchable yet. */
function JobReadyBanner() {
  const [jr, setJr] = useState<JobReadyLite | null>(null);
  useEffect(() => { apiGet<JobReadyLite>('/service-provider/job-ready').then(setJr).catch(() => {}); }, []);

  if (!jr || jr.jobReady) return null;
  const done = Object.values(jr.cards).filter((c) => c.complete).length;
  const left = Math.max(0, 5 - done);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: '#FEF6E7', border: '1px solid #F5D9A8', borderRadius: 12,
        padding: '12px 14px', margin: '0 0 14px',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', color: '#C77D0A' }}><AlertCircle size={18} /></span>
      <span style={{ fontSize: 13.5, color: '#7A4E06', fontWeight: 600 }}>
        You&apos;re not receiving jobs yet
        <span style={{ fontWeight: 400, color: '#8A6D17' }}>
          {' '}— {left} card{left === 1 ? '' : 's'} left in Get job-ready. Finish them and bookings in your areas start arriving here.
        </span>
      </span>
      <Link
        href="/dashboard/service-provider/job-ready"
        style={{
          marginLeft: 'auto', background: '#0B7A4E', color: '#fff', borderRadius: 9,
          padding: '8px 15px', fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
        }}
      >
        Get job-ready · {done}/5 →
      </Link>
    </div>
  );
}

export default function SpOperationsPage() {
  return (
    <Suspense fallback={null}>
      <JobReadyBanner />
      <SpOperationsPipelines />
    </Suspense>
  );
}
