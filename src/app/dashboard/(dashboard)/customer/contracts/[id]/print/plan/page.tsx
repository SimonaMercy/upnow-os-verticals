/**
 * Customer payment-plan route — same shared <PaymentPlanViewer> as the RP side,
 * fetched from the tenant contract endpoint. Clean downloadable PDF, no watermark.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { PlanViewerContract } from '@/components/upnow/PaymentPlanPdf';

function FullScreenLoader() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#52555a' }}>
      <Loader2 className="animate-spin" size={32} style={{ color: '#fff' }} />
    </div>
  );
}

const PaymentPlanViewer = dynamic(() => import('@/components/upnow/PaymentPlanPdf'), {
  ssr: false,
  loading: () => <FullScreenLoader />,
});

export default function CustomerPaymentPlanPage() {
  const params = useParams<{ id: string }>();
  const [contract, setContract] = useState<PlanViewerContract | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/contracts/tenant/${params.id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then(setContract).catch(e => setError(e.message));
  }, [params?.id]);

  if (error) return <div style={{ padding: 40, color: '#c00' }}>Failed to load contract: {error}</div>;
  if (!contract) return <FullScreenLoader />;

  return <PaymentPlanViewer contract={contract} />;
}
