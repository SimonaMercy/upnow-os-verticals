'use client';

/**
 * Operations › Long-term leases › Lease documents — Genspark OS rebuild of the
 * RP-side lease document workspace (opens from the contract's "View all").
 * Re-exported unchanged by /dashboard/manager/contracts/[id]/documents (the
 * manager vs RP context is derived from the URL).
 *
 * Customer document UPLOADS stay only on the customer's Spaces page (AGENTS.md);
 * this page reviews, re-files, downloads and signs — it uploads nothing.
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - GET /api/contracts/:id, GET /api/contracts/:id/signatures, fetchPaymentRefs(id),
 *    fetchSignatureCertificate(id) — one AbortController, refetched after every change.
 *  - The full <ContractDocsBinder/> (REUSED unchanged — the same binder backs the
 *    landlord's no-login magic-link page): KYC + tenancy panes, plan, receipts,
 *    agreement, signature certificate, "Download documents" PDF, document reader,
 *    re-file via PATCH /api/documents/:id/section {section, contractId},
 *    landlord signing via POST /api/contracts/:id/sign {role:'landlord', signatoryName,
 *    signatureImage, method:'online', consent:true, clientMeta, geo}, POA "on behalf
 *    of" naming, manager gate canSignDocuments && canActAsPoa, LandlordLinkButton
 *    ("Send landlord signing link"), customer-profile link for missing KYC (manager
 *    needs ?rp=), wordmark home link, ended-lease move-out artifacts.
 *  - Close (binder) → back to this lease documents page; "Back to lease" here goes to
 *    contractHref(id, 'lease', manager ? {rp} : null) exactly as the old Close did.
 *  - Load error / loading states (now kit Callout with "Try again" + skeleton).
 *  - New (read-only, same data): page head, scope strip, document counts, the list of
 *    documents on file (each "Open binder"), and the signature trail. The binder now
 *    opens from "Open document binder" instead of covering the page on arrival.
 */

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FolderOpen } from 'lucide-react';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { useAuth } from '@/contexts/AuthContext';
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';
import type { ReceiptContract } from '@/components/upnow/PaymentReceiptPdf';
import { ContractDocsBinder, LandlordLinkButton, type BinderDoc } from '@/components/upnow/ContractDocsBinder';
import { contractHref } from '@/lib/contractHref';
import { type PlanPayment } from '@/lib/currentPlan';
import { toEjari } from '@/lib/toEjari';
import { currentDocWatermark } from '@/lib/docViewer';
import { fetchPaymentRefs, EMPTY_PAYMENT_REFS, type PaymentRefs } from '@/lib/paymentRefs';
import { collectClientMeta, collectGeo } from '@/lib/signEvidence';
import { fetchSignatureCertificate, type SignatureCertificateData } from '@/components/upnow/SignatureCertificatePdf';
import {
  OsPage, PageHead, ScopeStrip, Card, Kpis, Kpi, Pill, StatusTag, Btn, TableWrap, EmptyRow, Callout, Timeline, humanize,
} from '@/components/os/kit';

interface Sig { role: string; signatoryName: string | null; signatureImage: string | null; signedAt: string; method?: string }
interface Contract {
  id: number; ref: string; contractType: 'new' | 'renewal'; status: string;
  pdcConfirmed?: boolean; contractActive?: boolean; vacateAtEnd?: boolean;
  originLeadId?: number | null; offerPlan?: OfferPlan | null;
  termination?: { response?: string | null } | null;
  documents?: BinderDoc[];
  landlord?: { id?: number | null; name?: string | null; companyName?: string | null; hasPoa?: boolean; poaPersonName?: string | null } | null;
  tenant?: { id?: number | null } | null;
  payments?: PlanPayment[];
  fees?: PlanPayment[];
}

const fmtStamp = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });

export default function ContractDocumentsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  // Signing the tenancy contract as landlord needs signing rights AND power of
  // attorney — so a delegated manager needs canSignDocuments && canActAsPoa on
  // the acting landlord. RP owners (not in the /manager portal) always may.
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isManagerView = pathname?.startsWith('/dashboard/manager') ?? false;
  const { canForRp } = useManagerPermissions();
  const { user: authUser } = useAuth();
  const [c, setC] = useState<Contract | null>(null);
  const [sigs, setSigs] = useState<Sig[]>([]);
  const [cert, setCert] = useState<SignatureCertificateData | null>(null);
  const [refs, setRefs] = useState<PaymentRefs>(EMPTY_PAYMENT_REFS);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = () => setReloadKey(k => k + 1);
  const [watermark] = useState(() => currentDocWatermark());
  // The full-screen binder is opened from this page and closes back to it.
  const [binderOpen, setBinderOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    fetch(`/api/contracts/${id}`, { credentials: 'include', signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('Error ' + r.status); return r.json() as Promise<Contract>; })
      .then(d => setC(d))
      .then(() => setErr(null))
      .catch(e => { if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : 'Failed to load'); });
    fetch(`/api/contracts/${id}/signatures`, { credentials: 'include', signal: ctrl.signal })
      .then(r => (r.ok ? r.json() as Promise<Sig[]> : []))
      .then(s => setSigs(Array.isArray(s) ? s : []))
      .catch(() => { /* non-fatal */ });
    fetchPaymentRefs(id, ctrl.signal).then(setRefs).catch(() => { /* non-fatal */ });
    fetchSignatureCertificate(id, ctrl.signal).then(setCert).catch(() => { /* non-fatal */ });
    return () => ctrl.abort();
  }, [id, reloadKey]);

  const head = (title: React.ReactNode, actions?: React.ReactNode) => (
    <PageHead
      eyebrow="Operations › Long-term leases"
      title={title}
      lede="Every document filed on this lease — customer KYC, tenancy documents, the payment plan, receipts and the agreement. Customers upload from their Spaces page; here you review, re-file, download and sign."
      actions={actions}
    />
  );
  if (err && !c) {
    return (
      <OsPage>
        {head(<>Lease documents · CID-{id}</>)}
        <Callout tone="bad" title="Failed to load documents.">
          {err} <Btn size="xs" onClick={refresh}>Try again</Btn>
        </Callout>
      </OsPage>
    );
  }
  if (!c) {
    return (
      <OsPage>
        {head(<>Lease documents · CID-{id}</>)}
        <Card pad><div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
          {[70, 45, 60, 35].map((w, i) => <div key={i} className="gx-skel" style={{ height: 14, width: `${w}%` }} />)}
        </div></Card>
      </OsPage>
    );
  }

  const landlordId = c.landlord?.id ?? null;
  const canLandlordSign = !isManagerView
    || (landlordId != null && canForRp('canSignDocuments', landlordId) && canForRp('canActAsPoa', landlordId));

  // A manager signing the landlord's signature does so under POA — show their own
  // name with an "on behalf of {landlord}" line (the backend stamps the same).
  const landlordName = c.landlord?.companyName || c.landlord?.name || 'Landlord';
  // POA holder on file → the landlord signature is legally theirs, "on behalf of"
  // the landlord (matches the backend stamp + the v2 signing surface).
  const poaHolder = c.landlord?.hasPoa && c.landlord?.poaPersonName?.trim() ? c.landlord.poaPersonName.trim() : null;
  const signerName = isManagerView ? (authUser?.name || 'Authorised Manager') : (poaHolder ?? landlordName);
  const signerOnBehalfOf = isManagerView ? landlordName : (poaHolder ? landlordName : undefined);

  // Where a missing KYC side gets uploaded — the customer's profile, in whichever
  // portal is rendering. A manager needs the landlord scope on the URL, so with no
  // scope resolvable the binder shows the placeholder without a link.
  const rpScope = searchParams?.get('rp') || (landlordId != null ? String(landlordId) : '');
  const profileHref = !c.tenant?.id ? null
    : isManagerView ? (rpScope ? `/dashboard/manager/tenants/${c.tenant.id}?rp=${rpScope}` : null)
    : `/rental-provider/dashboard/tenants/${c.tenant.id}`;

  // "Back to lease" goes to the contract — this workspace is only ever reached from
  // its "View all", so that IS the page behind it. Deliberately NOT history.back():
  // deep-linked, opened in a new tab, or arrived at from outside the app there is
  // nothing safe to pop. The binder's own Close returns to this page.
  const leaseHref = contractHref(c.id, 'lease', isManagerView && rpScope ? { rp: Number(rpScope) } : null);
  const close = () => router.push(leaseHref);
  // The wordmark is the way home, as it is on every other page — Close returns to
  // the lease this binder belongs to, the logo leaves the lease entirely. A
  // manager's dashboard needs its landlord scope, same as every other manager link.
  const homeHref = isManagerView
    ? (rpScope ? `/dashboard/manager?rp=${rpScope}` : '/dashboard/manager')
    : '/rental-provider/dashboard';

  const ejari = toEjari(c, sigs);
  const sign = async ({ signatureImage, signatoryName }: { signatureImage: string; signatoryName: string }) => {
    const res = await fetch(`/api/contracts/${c.id}/sign`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      // consent: the binder's ContractSignBar gates signing behind its
      // review-and-agree checkbox, so reaching here means it was ticked.
      body: JSON.stringify({ role: 'landlord', signatoryName, signatureImage, method: 'online', consent: true, clientMeta: collectClientMeta(), geo: await collectGeo() }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.message || `Could not sign (${res.status})`); }
    refresh();
  };

  const docs = c.documents ?? [];
  const kycCount = docs.filter(d => d.section === 'kyc').length;
  const tenancyCount = docs.filter(d => d.section === 'tenancy').length;
  const landlordSigned = sigs.some(s => s.role === 'landlord');
  const ended = c.status === 'terminated' || c.termination?.response === 'accepted' || !!c.vacateAtEnd;
  const roleLabel = (r: string) => (r === 'tenant' ? 'Tenant' : r === 'landlord' ? 'Landlord' : humanize(r));

  if (binderOpen) return (
    <ContractDocsBinder
      refLabel={c.ref}
      contractType={c.contractType}
      ended={c.status === 'terminated' || c.termination?.response === 'accepted' || !!c.vacateAtEnd}
      documents={c.documents ?? []}
      // Re-file a misfiled document. The section is where the document lives, so
      // the backend moves its owner too — moving one to Customer KYC starts
      // showing it on the customer's profile and on their other leases.
      onSetSection={async (doc, next) => {
        const res = await fetch(`/api/documents/${doc.id}/section`, {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: next, contractId: c.id }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({})) as { message?: string | string[] };
          throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Could not move the document (${res.status})`));
        }
        refresh();
      }}
      tenant={ejari.tenant}
      ejari={ejari}
      planContract={c}
      planPayments={c.payments ?? []}
      paymentRefs={refs}
      receipt={c as unknown as ReceiptContract}
      watermark={watermark}
      profileHref={profileHref}
      homeHref={homeHref}
      signatureCertificate={cert}
      headerRight={c.tenant?.id && canLandlordSign ? <LandlordLinkButton tenantId={c.tenant.id} contractId={c.id} /> : undefined}
      onClose={() => setBinderOpen(false)}
      signerName={signerName}
      signerOnBehalfOf={signerOnBehalfOf}
      signerDefaultName={isManagerView ? (authUser?.name || '') : (poaHolder ?? c.landlord?.name ?? c.landlord?.companyName ?? '')}
      landlordSigned={landlordSigned}
      canLandlordSign={canLandlordSign}
      onSign={sign}
    />
  );

  return (
    <OsPage>
      {head(<>Lease documents · {c.ref}</>, <>
        <Btn onClick={close}><ArrowLeft size={13} aria-hidden /> Back to lease</Btn>
        {c.tenant?.id && canLandlordSign ? <LandlordLinkButton tenantId={c.tenant.id} contractId={c.id} /> : null}
        <Btn variant="primary" onClick={() => setBinderOpen(true)}><FolderOpen size={13} aria-hidden /> Open document binder</Btn>
      </>)}

      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: 'Long-term leases' },
        { label: 'Contract', value: c.ref },
        { label: 'Type', value: c.contractType === 'renewal' ? 'Renewal' : 'New lease' },
        { label: 'Lease', value: <StatusTag status={c.status} /> },
        { label: 'Landlord signature', value: landlordSigned ? <Pill tone="primary">Signed</Pill> : <Pill tone="amber">Not signed</Pill> },
      ]} />

      {err && <Callout tone="bad" title="Couldn’t refresh.">{err} <Btn size="xs" onClick={refresh}>Try again</Btn></Callout>}
      {!landlordSigned && !canLandlordSign && (
        <Callout tone="info" title="View only for signing.">Signing the tenancy contract as landlord needs signing rights and power of attorney for this landlord.</Callout>
      )}

      <div style={{ marginTop: 14 }}>
        <Kpis>
          <Kpi k="Documents on file" v={docs.length} d={ended ? 'includes move-out records' : 'on this lease'} />
          <Kpi k="Customer KYC" v={kycCount} d="filed under KYC" />
          <Kpi k="Tenancy" v={tenancyCount} d="filed under tenancy" />
          <Kpi k="Signatures" v={sigs.length} d={landlordSigned ? 'landlord has signed' : 'landlord signature pending'} dark />
        </Kpis>
      </div>

      <div className="gx-cols gx-cols-2">
        <TableWrap toolbar={<>
          <b style={{ fontSize: 13 }}>Documents on file</b>
          <span className="sp" />
          <Btn size="sm" onClick={() => setBinderOpen(true)}>Open binder</Btn>
        </>}>
          <table className="gx-tbl">
            <thead><tr><th>Document</th><th>Section</th><th>Category</th><th className="act">Action</th></tr></thead>
            {docs.length === 0 ? (
              <EmptyRow cols={4} title="No documents filed yet." text=" The plan, receipts and agreement are still generated in the binder; customer uploads arrive from their Spaces page." />
            ) : (
              <tbody>
                {docs.map(d => (
                  <tr key={d.id}>
                    <td className="strong">{d.displayName || humanize(d.documentKey)}<span className="sub mono">{d.documentKey}</span></td>
                    <td>{d.section === 'kyc' ? <Pill tone="info">Customer KYC</Pill> : d.section === 'tenancy' ? <Pill tone="primary">Tenancy</Pill> : <Pill tone="neutral">Default</Pill>}</td>
                    <td>{d.category ? humanize(d.category) : '—'}</td>
                    <td className="act"><Btn size="xs" onClick={() => setBinderOpen(true)}>Open binder</Btn></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </TableWrap>

        <Card title="Signature trail" sub="Who has signed the tenancy contract">
          <div className="gx-pad">
            {sigs.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--ms-ink-3)' }}>No signatures yet. Sign as landlord from the binder once the documents are verified.</p>
            ) : (
              <Timeline items={sigs.map(s => ({
                t: <>{roleLabel(s.role)} signed{s.signatoryName ? ` — ${s.signatoryName}` : ''}</>,
                s: <>{fmtStamp(s.signedAt)}{s.method ? ` · ${humanize(s.method)}` : ''}</>,
                state: 'done' as const,
              }))} />
            )}
          </div>
        </Card>
      </div>
    </OsPage>
  );
}
