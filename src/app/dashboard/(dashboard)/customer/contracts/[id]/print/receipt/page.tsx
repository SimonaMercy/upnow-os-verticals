/**
 * Customer payment-receipt route.
 *
 * Thin data shell: fetches the contract (tenant endpoint) and renders the shared
 * <PaymentReceiptViewer> — a real @react-pdf document (same approach as the
 * tenancy-contract print). Select by ?kind=rental|deposit|management (the three
 * segmented receipts), the legacy ?kind=contract, ?pid=<paymentId>, or ?p=<index>.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { ReceiptContract } from '@/components/upnow/PaymentReceiptPdf';
import { shapePaymentRefs, type RawPaymentRefs } from '@/lib/paymentRefs';

/** The tenant endpoint embeds the landlord's issued reconciliation numbers in the
 *  raw wire shape (same as GET /contracts/:id/payment-refs) — shape it through the
 *  shared helper so the customer's receipts print the SAME numbers as the RP's. */
type TenantReceiptPayload = Omit<ReceiptContract, 'paymentRefs'> & { paymentRefs?: RawPaymentRefs | null };

function FullScreenLoader() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#52555a' }}>
      <Loader2 className="animate-spin" size={32} style={{ color: '#fff' }} />
    </div>
  );
}

const PaymentReceiptViewer = dynamic(() => import('@/components/upnow/PaymentReceiptPdf'), {
  ssr: false,
  loading: () => <FullScreenLoader />,
});

export default function CustomerReceiptPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const pid = searchParams?.get('pid');
  const kind = searchParams?.get('kind') as 'deposit' | 'contract' | 'rental' | 'management' | null;
  const idx = parseInt(searchParams?.get('p') ?? '0', 10);

  const [contract, setContract] = useState<ReceiptContract | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/contracts/tenant/${params.id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json() as Promise<TenantReceiptPayload>; })
      .then(({ paymentRefs, ...rest }) => setContract({ ...rest, paymentRefs: shapePaymentRefs(paymentRefs ?? {}) }))
      .catch(e => setError(e.message));
  }, [params?.id]);

  if (error) return <div style={{ padding: 40, color: '#c00' }}>Failed to load receipt: {error}</div>;
  if (!contract) return <FullScreenLoader />;

  return <PaymentReceiptViewer contract={contract} kind={kind} selectedId={pid ? Number(pid) : null} selectedIdx={Number.isNaN(idx) ? 0 : idx} />;
}
