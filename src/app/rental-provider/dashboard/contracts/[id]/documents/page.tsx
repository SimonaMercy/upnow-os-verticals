/**
 * Full-page document workspace (opens from the contract's "View all"). Thin data
 * adapter: it fetches the contract (+ signatures) and hands them to the shared
 * <ContractDocsBinder/>, which renders the two-pane verify-and-sign binder. The
 * exact same binder backs the landlord's no-login magic-link page, so the two
 * always match.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';
import type { ReceiptContract } from '@/components/upnow/PaymentReceiptPdf';
import { ContractDocsBinder, LandlordLinkButton, type BinderDoc } from '@/components/upnow/ContractDocsBinder';
import { type PlanPayment } from '@/lib/currentPlan';
import { toEjari } from '@/lib/toEjari';
import { currentDocWatermark } from '@/lib/docViewer';
import { fetchPaymentRefs, EMPTY_PAYMENT_REFS, type PaymentRefs } from '@/lib/paymentRefs';
import { collectClientMeta } from '@/lib/signEvidence';
import { fetchSignatureCertificate, type SignatureCertificateData } from '@/components/upnow/SignatureCertificatePdf';

interface Sig { role: string; signatoryName: string | null; signatureImage: string | null; signedAt: string; method?: string }
interface Contract {
  id: number; ref: string; contractType: 'new' | 'renewal'; status: string;
  pdcConfirmed?: boolean; contractActive?: boolean; vacateAtEnd?: boolean;
  originLeadId?: number | null; offerPlan?: OfferPlan | null;
  termination?: { response?: string | null } | null;
  documents?: BinderDoc[];
  landlord?: { name?: string | null; companyName?: string | null } | null;
  tenant?: { id?: number | null } | null;
  payments?: PlanPayment[];
  fees?: PlanPayment[];
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#6b6860' }}>{children}</div>;
}

export default function ContractDocumentsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [c, setC] = useState<Contract | null>(null);
  const [sigs, setSigs] = useState<Sig[]>([]);
  const [cert, setCert] = useState<SignatureCertificateData | null>(null);
  const [refs, setRefs] = useState<PaymentRefs>(EMPTY_PAYMENT_REFS);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = () => setReloadKey(k => k + 1);
  const [watermark] = useState(() => currentDocWatermark());

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    fetch(`/api/contracts/${id}`, { credentials: 'include', signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('Error ' + r.status); return r.json() as Promise<Contract>; })
      .then(d => setC(d))
      .catch(e => { if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : 'Failed to load'); });
    fetch(`/api/contracts/${id}/signatures`, { credentials: 'include', signal: ctrl.signal })
      .then(r => (r.ok ? r.json() as Promise<Sig[]> : []))
      .then(s => setSigs(Array.isArray(s) ? s : []))
      .catch(() => { /* non-fatal */ });
    fetchPaymentRefs(id, ctrl.signal).then(setRefs).catch(() => { /* non-fatal */ });
    fetchSignatureCertificate(id, ctrl.signal).then(setCert).catch(() => { /* non-fatal */ });
    return () => ctrl.abort();
  }, [id, reloadKey]);

  if (err) return <Center>Failed to load documents: {err}</Center>;
  if (!c) return <Center><Loader2 className="animate-spin" size={32} /></Center>;

  const ejari = toEjari(c, sigs);
  const sign = async ({ signatureImage, signatoryName }: { signatureImage: string; signatoryName: string }) => {
    const res = await fetch(`/api/contracts/${c.id}/sign`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      // consent: the binder's ContractSignBar gates signing behind its
      // review-and-agree checkbox, so reaching here means it was ticked.
      body: JSON.stringify({ role: 'landlord', signatoryName, signatureImage, method: 'online', consent: true, clientMeta: collectClientMeta() }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.message || `Could not sign (${res.status})`); }
    refresh();
  };

  return (
    <ContractDocsBinder
      refLabel={c.ref}
      contractType={c.contractType}
      ended={c.status === 'terminated' || c.termination?.response === 'accepted' || !!c.vacateAtEnd}
      documents={c.documents ?? []}
      tenant={ejari.tenant}
      ejari={ejari}
      planContract={c}
      planPayments={c.payments ?? []}
      paymentRefs={refs}
      receipt={c as unknown as ReceiptContract}
      watermark={watermark}
      signatureCertificate={cert}
      headerRight={c.tenant?.id ? <LandlordLinkButton tenantId={c.tenant.id} contractId={c.id} /> : undefined}
      signerName={c.landlord?.companyName || c.landlord?.name || 'Landlord'}
      signerDefaultName={c.landlord?.name || c.landlord?.companyName || ''}
      landlordSigned={sigs.some(s => s.role === 'landlord')}
      onSign={sign}
    />
  );
}
