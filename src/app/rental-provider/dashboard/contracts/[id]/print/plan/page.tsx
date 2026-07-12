/**
 * RP / manager payment-plan route.
 *
 * Thin data shell: fetches the full contract (RP endpoint) and renders the shared
 * <PaymentPlanViewer> — a real @react-pdf document (same approach as the
 * tenancy-contract + receipt prints) so it downloads cleanly, no watermark.
 * The manager portal re-exports this page.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { PlanViewerContract } from '@/components/upnow/PaymentPlanPdf';
import { fetchPaymentRefs } from '@/lib/paymentRefs';

function FullScreenLoader() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#52555a' }}>
      <Loader2 className="animate-spin" size={32} style={{ color: '#fff' }} />
    </div>
  );
}

// @react-pdf must run client-side only.
const PaymentPlanViewer = dynamic(() => import('@/components/upnow/PaymentPlanPdf'), {
  ssr: false,
  loading: () => <FullScreenLoader />,
});

export default function PaymentPlanPrintPage() {
  const params = useParams<{ id: string }>();
  const [contract, setContract] = useState<PlanViewerContract | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/contracts/${params.id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then(async (c: PlanViewerContract) => {
        // The plan reference (PP-<rp>-<year>-<nnnnn>) lives on the payment-refs
        // endpoint, not the contract — fold it in for the header.
        const refs = await fetchPaymentRefs(params.id).catch(() => null);
        setContract(refs?.planRefNo ? { ...c, planRefNo: refs.planRefNo } : c);
      })
      .catch(e => setError(e.message));
  }, [params?.id]);

  if (error) return <div style={{ padding: 40, color: '#c00' }}>Failed to load contract: {error}</div>;
  if (!contract) return <FullScreenLoader />;

  return <PaymentPlanViewer contract={contract} />;
}
