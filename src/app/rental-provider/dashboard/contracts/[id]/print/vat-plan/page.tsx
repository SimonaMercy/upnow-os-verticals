/**
 * RP / manager Net · VAT · Total payment plan (the Payment Summary's sibling —
 * see components/upnow/VatPlanPdf). New leases and renewals alike.
 * The manager portal re-exports this page.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { VatPlanContract } from '@/components/upnow/VatPlanPdf';

function FullScreenLoader() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#52555a' }}>
      <Loader2 className="animate-spin" size={32} style={{ color: '#fff' }} />
    </div>
  );
}

// @react-pdf must run client-side only.
const VatPlanViewer = dynamic(() => import('@/components/upnow/VatPlanPdf'), {
  ssr: false,
  loading: () => <FullScreenLoader />,
});

export default function VatPlanPrintPage() {
  const params = useParams<{ id: string }>();
  const [contract, setContract] = useState<VatPlanContract | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/contracts/${params.id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then((c: VatPlanContract) => setContract(c))
      .catch(e => setError(e.message));
  }, [params?.id]);

  if (error) return <div style={{ padding: 40, color: '#c00' }}>Failed to load contract: {error}</div>;
  if (!contract) return <FullScreenLoader />;

  return <VatPlanViewer contract={contract} />;
}
