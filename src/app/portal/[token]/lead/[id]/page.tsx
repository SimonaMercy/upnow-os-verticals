'use client';

/**
 * Landlord's application review — no login, magic link.
 *
 * The lead-stage twin of /portal/<token>/contract/<id>, and deliberately the SAME
 * surface: it renders the shared <ContractDocsBinder/> in lead mode, so the
 * landlord reads an application exactly the way they read a lease — identity and
 * KYC full-preview down the left, the money and the cheques down the right, jump
 * chips on both. What changes is the bottom bar: a lease is signed, an
 * application is approved or declined.
 *
 * The answer is recorded on the lead and shown to the RP. It does NOT move the
 * lead's stage — the pipeline stays in the RP's hands (owner's choice, 24 Sep 2026).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { ContractDocsBinder, type BinderDoc } from '@/components/upnow/ContractDocsBinder';
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';
import { currentDocWatermark } from '@/lib/docViewer';
import { APP_TIME_ZONE } from '@/lib/datetime';

interface ReviewDoc {
  id: number; documentKey: string; displayName: string | null;
  category: string | null; status: string | null; fileUrl: string; mimeType: string | null;
}
interface Review {
  lead: { id: number; stage: string; createdAt: string; reviewStatus: 'approved' | 'declined' | null; reviewedAt: string | null };
  applicant: { name: string; companyName: string | null; entityType: string | null; email: string | null; phone: string | null };
  unit: {
    unitNumber: string | null; unitType: string | null; bedrooms: number | null; bathrooms: number | null;
    sizeSqft: string | number | null; furnishing: string | null; rentalPrice: string | number | null;
    buildingName: string | null; emirate: string | null; community: string | null;
  };
  landlordName: string | null;
  paymentPlan: OfferPlan | null;
  documents: ReviewDoc[];
  expiresAt: string;
}

const day = (v: string | null | undefined) =>
  !v ? '' : new Date(v).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE });

export default function LeadReviewPage() {
  const params = useParams<{ token: string; id: string }>();
  const token = String(params?.token ?? '');
  const leadId = String(params?.id ?? '');

  const [data, setData] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<'approved' | 'declined' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [watermark] = useState(() => currentDocWatermark());

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/portal/${token}/leads/${leadId}`, { credentials: 'omit', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.message || 'This link is not valid')))))
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'This link is not valid'))
      .finally(() => setLoading(false));
  }, [token, leadId]);
  useEffect(() => { load(); }, [load]);

  async function answer(decision: 'approved' | 'declined') {
    setSending(decision);
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/${token}/leads/${leadId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { message?: string }).message || 'Could not record your answer');
      }
      load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not record your answer');
    } finally {
      setSending(null);
    }
  }

  if (loading) return <Centered><Loader2 className="animate-spin" /> Loading…</Centered>;
  if (error || !data) return (
    <Centered>
      <div style={{ textAlign: 'center' }}>
        <AlertTriangle style={{ margin: '0 auto 8px', color: '#b45309' }} />
        <p style={{ fontWeight: 700, color: '#1a1916' }}>{error ?? 'Link not available'}</p>
        <p style={{ fontSize: 13, color: '#9b9890', marginTop: 4 }}>Please ask your property manager to send a new link.</p>
      </div>
    </Centered>
  );

  const { applicant, unit } = data;
  // The binder reads the same shape the lease gives it — the application's own
  // documents, which at lead stage are the customer's KYC pack plus any cheques.
  const documents: BinderDoc[] = data.documents.map(d => ({
    id: d.id, documentKey: d.documentKey, displayName: d.displayName,
    fileUrl: d.fileUrl, category: d.category, ownerType: 'customer', section: null,
  }));

  const unitLabel = [data.unit.buildingName, data.unit.unitNumber ? `Unit ${data.unit.unitNumber}` : null]
    .filter(Boolean).join(' · ');

  return (
    <ContractDocsBinder
      title="Application for your approval"
      refLabel={unitLabel || `Lead-${data.lead.id}`}
      documents={documents}
      tenant={{
        name: applicant.name, email: applicant.email, phone: applicant.phone,
        companyName: applicant.companyName,
      }}
      // No ejari → lead mode: no Agreement / Registration slots, nothing to sign.
      planContract={{}}
      planPayments={[]}
      planOverride={data.paymentPlan}
      planMeta={{
        landlordName: data.landlordName,
        unitNumber: unit.unitNumber,
        buildingName: unit.buildingName,
        community: unit.community || unit.emirate,
      }}
      watermark={watermark}
      portalToken={token}
      footer={
        <AnswerBar
          answered={data.lead.reviewStatus}
          answeredAt={data.lead.reviewedAt}
          sending={sending}
          error={actionError}
          onAnswer={answer}
        />
      }
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#6b6860', fontSize: 13, background: '#f4f3ef', padding: 24 }}>
      {children}
    </div>
  );
}

/**
 * The bottom bar — where a lease binder signs, an application is answered.
 * Mirrors ContractSignBar's shape (sticky, full width, review note on the left,
 * the act on the right) so the two surfaces feel like one product.
 */
function AnswerBar({ answered, answeredAt, sending, error, onAnswer }: {
  answered: 'approved' | 'declined' | null;
  answeredAt: string | null;
  sending: 'approved' | 'declined' | null;
  error: string | null;
  onAnswer: (d: 'approved' | 'declined') => void;
}) {
  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px',
    borderRadius: 10, fontSize: 13.5, fontWeight: 800, cursor: 'pointer', border: '1px solid transparent',
  };
  return (
    <div style={{ flexShrink: 0, background: '#fff', borderTop: '1px solid #e3e0d9', padding: '12px 20px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        {answered ? (
          <p style={{ fontSize: 13, fontWeight: 700, color: answered === 'approved' ? '#16a34a' : '#ef4444', margin: 0 }}>
            You {answered === 'approved' ? 'approved' : 'declined'} this application{answeredAt ? ` on ${day(answeredAt)}` : ''}.
            <span style={{ fontWeight: 500, color: '#9b9890' }}> Your property manager has it. You can change your answer while this link is live.</span>
          </p>
        ) : (
          <p style={{ fontSize: 13, color: '#6b6860', margin: 0 }}>
            You&apos;ve reviewed the applicant, their documents and the payment plan above.
          </p>
        )}
        {error && <p style={{ fontSize: 12, color: '#ef4444', margin: '4px 0 0' }}>{error}</p>}
      </div>
      <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
        <button
          type="button" disabled={sending !== null} onClick={() => onAnswer('declined')}
          style={{ ...btn, background: answered === 'declined' ? '#fff1f2' : '#fff', borderColor: answered === 'declined' ? '#fecaca' : '#e3e0d9', color: answered === 'declined' ? '#ef4444' : '#6b6860', opacity: sending ? 0.6 : 1 }}
        >
          {sending === 'declined' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
          {answered === 'declined' ? 'Declined' : 'Decline'}
        </button>
        <button
          type="button" disabled={sending !== null} onClick={() => onAnswer('approved')}
          style={{ ...btn, background: answered === 'approved' ? '#16a34a' : '#2e9f82', color: '#fff', opacity: sending ? 0.6 : 1 }}
        >
          {sending === 'approved' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {answered === 'approved' ? 'Approved' : 'Approve'}
        </button>
      </div>
    </div>
  );
}
