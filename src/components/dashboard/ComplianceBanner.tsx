'use client';

/**
 * Sticky compliance banner shown across the RP dashboard when the rental
 * provider is signed in but NOT yet compliant (and not paused/blocked — those
 * are hard-gated by RpOnboardingGate). Replaces the old "blindly bounce them to
 * a generic setup form" behaviour: the RP keeps read access to their dashboard
 * while a clear, status-specific banner tells them exactly what's outstanding
 * and links back to /onboarding to resolve it.
 */

import Link from 'next/link';
import { AlertCircle, Clock, ArrowRight } from 'lucide-react';

const ONBOARDING_PATH = '/rental-provider/dashboard/onboarding';

type Variant = { bg: string; border: string; fg: string; icon: 'alert' | 'clock'; title: string; cta: string };

const VARIANTS: Record<string, Variant> = {
  action_required: { bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c', icon: 'alert', title: 'Action required to finish verification', cta: 'Resolve now' },
  expired:         { bg: '#fffbeb', border: '#fde68a', fg: '#b45309', icon: 'alert', title: 'Your verification has expired', cta: 'Renew verification' },
  pending_review:  { bg: '#eff6ff', border: '#bfdbfe', fg: '#1d4ed8', icon: 'clock', title: 'Verification under review', cta: 'View status' },
};

export function ComplianceBanner({ status, notes }: { status: string; notes?: string | null }) {
  const v = VARIANTS[status] ?? VARIANTS.pending_review;
  const Icon = v.icon === 'clock' ? Clock : AlertCircle;
  const detail = notes?.trim()
    ? notes
    : status === 'pending_review'
      ? "We'll email you the moment it's approved."
      : 'Complete the outstanding steps to restore full access.';
  return (
    <div
      role="status"
      style={{ background: v.bg, borderBottom: `1px solid ${v.border}`, color: v.fg }}
      className="sticky top-0 z-20 px-4 py-2.5 text-sm"
    >
      <div className="max-w-7xl mx-auto flex items-center gap-3">
        <Icon size={16} className="flex-shrink-0" />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{v.title}.</span>{' '}
          <span className="opacity-90">{detail}</span>
        </p>
        <Link
          href={ONBOARDING_PATH}
          className="flex-shrink-0 inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
        >
          {v.cta} <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
