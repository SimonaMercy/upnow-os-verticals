'use client';

/**
 * Prominent sticky action bar shown to a logged-in CUSTOMER on the marketing
 * landing page (/) when a renewal needs their attention — the RP has proposed a
 * renewal to review/accept, or an issued renewal is awaiting their signature.
 * Sticks directly under the landing nav (`.l-nav`, 74px tall) and deep-links to
 * the space journey where they act. Renders nothing when there's no action.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface TenantContract {
  id: number;
  status: string;
  parentContractId?: number | null;
  tenantSignedAt?: string | null;
  renewalAccepted?: 'pending' | 'accepted' | 'rejected' | null;
  unit?: { number?: string | null; name?: string | null } | null;
  property?: { buildingName?: string | null } | null;
}

type Action = { contractId: number; headline: string; unitLabel: string; cta: string };

export function CustomerRenewalBanner() {
  const { isAuthenticated, user } = useAuth();
  const [action, setAction] = useState<Action | null>(null);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'customer') return;
    let alive = true;
    fetch('/api/contracts/tenant', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((cs: TenantContract[]) => {
        if (!alive || !Array.isArray(cs)) return;
        // Renewal proposed on the active lease → review & respond.
        const review = cs.find(c => c.status === 'active' && c.renewalAccepted === 'pending');
        // Renewal contract issued but not yet signed by the tenant → sign.
        const sign = cs.find(c => c.status === 'issued' && !c.tenantSignedAt && c.parentContractId != null);
        const hit = review ?? sign;
        if (!hit) { setAction(null); return; }
        const unitLabel =
          hit.unit?.name ||
          hit.property?.buildingName ||
          (hit.unit?.number ? `Unit ${hit.unit.number}` : 'your space');
        setAction({
          contractId: hit.id,
          // The issued renewal moves through documents → cheques → signature; keep
          // the headline accurate for any of those sub-stages (the exact step is
          // shown once they open the space).
          headline: review
            ? 'Your lease renewal is ready to review'
            : 'Your lease renewal needs your attention',
          cta: review ? 'Review & respond' : 'Review & continue',
          unitLabel,
        });
      })
      .catch(() => { if (alive) setAction(null); });
    return () => { alive = false; };
  }, [isAuthenticated, user?.role]);

  if (!action || !isAuthenticated || user?.role !== 'customer') return null;

  return (
    <div
      style={{
        position: 'sticky',
        top: 73, // pins directly under the .l-nav (74px) as the page scrolls
        zIndex: 55,
        background: 'linear-gradient(90deg, #c2410c 0%, #ea580c 100%)',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 4px 14px rgba(194,65,12,0.25)',
      }}
    >
      <Link
        href={`/dashboard/customer/spaces/v2/c-${action.contractId}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          maxWidth: 1280,
          margin: '0 auto',
          padding: '11px 32px',
          textDecoration: 'none',
          color: '#fff',
        }}
      >
        <span
          style={{
            width: 26, height: 26, borderRadius: '50%',
            background: 'rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          <AlertCircle size={15} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, lineHeight: 1.3 }}>
            {action.headline}
            <span style={{ fontWeight: 500, opacity: 0.9 }}> · {action.unitLabel}</span>
          </p>
          <p style={{ margin: '1px 0 0', fontSize: 11.5, fontWeight: 500, opacity: 0.85 }}>
            Action needed from you to keep your tenancy on track.
          </p>
        </div>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
            fontSize: 12.5, fontWeight: 700, color: '#c2410c',
            background: '#fff', borderRadius: 999, padding: '7px 14px',
          }}
        >
          {action.cta} <ChevronRight size={15} />
        </span>
      </Link>
    </div>
  );
}
