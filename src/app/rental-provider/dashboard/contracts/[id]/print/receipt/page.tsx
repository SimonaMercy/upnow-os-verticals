/**
 * RP / manager payment-receipt route.
 *
 * Thin data shell: fetches the full contract (RP endpoint) and renders the shared
 * <PaymentReceiptViewer> — a real @react-pdf document (same approach as the
 * tenancy-contract print). Select by ?kind=contract|deposit, ?pid=<paymentId>,
 * or the legacy ?p=<index>. The manager portal re-exports this page.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { ReceiptContract } from '@/components/upnow/PaymentReceiptPdf';

function FullScreenLoader() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#52555a' }}>
      <Loader2 className="animate-spin" size={32} style={{ color: '#fff' }} />
    </div>
  );
}

// @react-pdf must run client-side only.
const PaymentReceiptViewer = dynamic(() => import('@/components/upnow/PaymentReceiptPdf'), {
  ssr: false,
  loading: () => <FullScreenLoader />,
});

export default function RentReceiptPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const pid = searchParams?.get('pid');
  const kind = searchParams?.get('kind') as 'deposit' | 'contract' | null;
  const idx = parseInt(searchParams?.get('p') ?? '0', 10);

  const [contract, setContract] = useState<ReceiptContract | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/contracts/${params.id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then(setContract).catch(e => setError(e.message));
  }, [params?.id]);

  if (error) return <div style={{ padding: 40, color: '#c00' }}>Failed to load contract: {error}</div>;
  if (!contract) return <FullScreenLoader />;

  return <PaymentReceiptViewer contract={contract} kind={kind} selectedId={pid ? Number(pid) : null} selectedIdx={Number.isNaN(idx) ? 0 : idx} />;
}
