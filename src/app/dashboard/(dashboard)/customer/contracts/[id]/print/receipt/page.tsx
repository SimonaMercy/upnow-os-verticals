/**
 * Customer payment-receipt route.
 *
 * Thin data shell: fetches the contract from the tenant endpoint and renders the
 * shared <PaymentReceipt> for the selected payment. Select by ?pid=<paymentId>
 * (preferred, order-safe) or the legacy ?p=<index>.
 *
 * The customer Payments tab links here once a payment is collected/cleared.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import PaymentReceipt, { type ReceiptContract } from '@/components/upnow/PaymentReceipt';

export default function CustomerReceiptPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const pid = searchParams?.get('pid');
  const kind = searchParams?.get('kind') as 'deposit' | 'contract' | null;
  const idx = parseInt(searchParams?.get('p') ?? '0', 10);

  const [contract, setContract] = useState<ReceiptContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/contracts/tenant/${params.id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then(setContract).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [params?.id]);

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 className="animate-spin" size={32} style={{ color: '#1a3c6e' }} /></div>;
  if (error || !contract) return <div style={{ padding: 40, color: '#c00' }}>Failed to load receipt: {error}</div>;

  return <PaymentReceipt contract={contract} kind={kind} selectedId={pid ? Number(pid) : null} selectedIdx={Number.isNaN(idx) ? 0 : idx} />;
}
