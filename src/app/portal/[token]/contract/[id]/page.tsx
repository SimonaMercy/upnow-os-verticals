'use client';

/**
 * Public tenant portal — dedicated contract review + sign page.
 * Shows the ACTUAL tenancy contract document (the same vector PDF used on the
 * RP/customer print pages) for the tenant to read, then a separate signing
 * section. No login.
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, Loader2, CheckCircle2, PenLine, ShieldCheck, AlertTriangle, FileText, Stamp, ExternalLink } from 'lucide-react';
import { openDocViewer, setDocViewerWatermark } from '@/lib/docViewer';
import { effectiveSpaceCategory } from '@/lib/unitTaxonomy';
import { collectClientMeta, collectGeo } from '@/lib/signEvidence';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import { DownloadDocButton } from '@/components/upnow/DownloadDocButton';
import { leaseDocFileName, type LeaseDocKind } from '@/lib/leaseDocName';
import { ContractDocsBinder, type BinderDoc } from '@/components/upnow/ContractDocsBinder';
import type { ReceiptContract } from '@/components/upnow/PaymentReceiptPdf';
import { shapePaymentRefs, type RawPaymentRefs } from '@/lib/paymentRefs';
import type { PlanContract, PlanPayment } from '@/lib/currentPlan';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';
import type { ReportMeta } from '@/components/contract/InspectionReportView';
import type { InspectionDoc } from '@/lib/inspectionCatalog';
import { InspectionPhotosCard } from '@/components/contract/InspectionPhotosCard';

const EjariInline = dynamic(() => import('@/components/contract/EjariInline'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8a948d]"><Loader2 className="animate-spin" size={16} /> Rendering your contract…</div>,
});

const InspectionInline = dynamic(() => import('@/components/contract/InspectionInline'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8a948d]"><Loader2 className="animate-spin" size={16} /> Rendering the inspection report…</div>,
});

const ReceiptButtons = dynamic(() => import('@/components/upnow/PaymentReceiptPdf').then(m => ({ default: m.ReceiptButtons })), {
  ssr: false,
  loading: () => <div className="flex items-center gap-2 py-1 text-sm text-[#8a948d]"><Loader2 className="animate-spin" size={14} /> Preparing receipts…</div>,
});

const ContractButtons = dynamic(() => import('@/components/contract/ContractButtons'), {
  ssr: false,
  loading: () => <div className="flex items-center gap-2 py-1 text-sm text-[#8a948d]"><Loader2 className="animate-spin" size={14} /> Preparing contract…</div>,
});

interface Doc { id?: number; documentKey: string; displayName: string | null; fileUrl: string; category?: string | null; ownerType?: string; section?: string | null; portalHidden?: boolean | null }
interface Sig { role: string; signatoryName: string | null; signatureImage: string | null; stampImage?: string | null; signedAt: string; method?: string }
interface Detail {
  contract: EjariContractData & { id: number; status: string | null; contractType?: string | null };
  documents: Doc[];
  /** Full binder (contract docs + KYC + deposit receipts + cheques) — only sent
   *  on landlord links, for the lessor's "all documents" review. */
  allDocuments?: Doc[];
  signatures: Sig[];
  /** Addendum(s) attached to the contract — rendered combined into the contract PDF. */
  addendums?: EjariAddendum[];
  tenantSigned: boolean;
  landlordSigned?: boolean;
  /** Live payment-plan + receipts inputs (not sent on inspector links). */
  plan?: { payments: PlanPayment[]; fees: PlanPayment[] };
  /** The landlord's issued reconciliation numbers (plan + one receipt per received
   *  cheque/deposit), so a receipt printed from this link carries the SAME numbers
   *  as the RP and customer dashboards instead of a derived label. */
  paymentRefs?: RawPaymentRefs | null;
  rentVatRate?: number;
  pdcConfirmed?: boolean;
  moveInAvailable: boolean;
  purpose?: 'all' | 'documents' | 'contract' | 'move_in' | 'move_out';
  /** 'inspector' = link issued for the on-site inspection manager, who
   *  counter-signs the RP side instead of signing as the customer.
   *  'landlord' = the lessor reviewing every document and signing as landlord. */
  signerRole?: 'tenant' | 'inspector' | 'landlord';
}

interface InspPhoto { id: string; url: string; caption?: string }
interface InspItem { name: string; inCondition?: string; outCondition?: string }
interface InspArea { name: string; items?: InspItem[]; remarks?: string }
interface Inspection {
  areas?: InspArea[];
  generalNotes?: string;
  photos?: InspPhoto[];
  moveInPhotos?: InspPhoto[];
  inspectorName?: string;
  rpSubmittedAt?: string | null;
  tenantSig?: string | null;
  tenantSignedAt?: string | null;
  rpCounterSig?: string | null;
}

const API = (token: string, path: string) => `/api/portal/${token}${path}`;
/** Backend already returns the EjariContractData-shaped nested object (incl.
 *  numberOfInstallments + unit.bedrooms) — just fold in signatures. The shared
 *  renderer formats Mode of Payment from the installment count. */
function toEjari(c: Detail['contract'], signatures: Sig[]): EjariContractData {
  return {
    ...c,
    signatures: (signatures ?? []).map(s => ({ role: s.role as 'landlord' | 'tenant', signatureImage: s.signatureImage ?? null, stampImage: s.stampImage ?? null, signedAt: s.signedAt, method: s.method })),
  };
}

export default function ContractReviewPage() {
  const params = useParams();
  const token = String(params.token);
  const id = Number(params.id);
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [insp, setInsp] = useState<Inspection | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(API(token, `/contracts/${id}`), { credentials: 'omit' })
      .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.message || 'Contract not available'))))
      .then(setD).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [token, id]);
  useEffect(() => { load(); }, [load]);

  // No auth user on the magic link — stamp viewed documents with the signer's
  // name (the landlord on a landlord link, otherwise the tenant).
  useEffect(() => {
    const isLandlord = (d?.signerRole ?? 'tenant') === 'landlord';
    const who = isLandlord
      ? (d?.contract?.landlord?.companyName ?? d?.contract?.landlord?.name ?? null)
      : (d?.contract?.tenant?.companyName ?? d?.contract?.tenant?.name ?? null);
    setDocViewerWatermark(who);
  }, [d]);

  // When the link is scoped to an inspection, the tenant should review the
  // inspection the RP recorded (not the tenancy contract) before signing.
  const inspType: 'move_in' | 'move_out' | null =
    d?.purpose === 'move_out' ? 'move_out' : d?.purpose === 'move_in' ? 'move_in' : null;
  const loadInsp = useCallback(() => {
    if (!inspType) { setInsp(null); return; }
    fetch(API(token, `/contracts/${id}/inspection?type=${inspType}`), { credentials: 'omit' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: Inspection | null) => setInsp(j ?? null))
      .catch(() => setInsp(null));
  }, [inspType, token, id]);
  useEffect(() => { loadInsp(); }, [loadInsp]);

  // Inspector links are a work surface, not a review page — send the on-site
  // inspection manager straight to the full inspection form (fill condition,
  // attach photos, submit, then counter-sign) rather than the contract review.
  const router = useRouter();
  useEffect(() => {
    if (!d) return;
    const isInsp = (d.signerRole ?? 'tenant') === 'inspector';
    if (isInsp && inspType) router.replace(`/portal/${token}/contract/${id}/inspection?type=${inspType}`);
  }, [d, inspType, router, token, id]);

  if (loading) return <Centered><Loader2 className="animate-spin" /> Loading contract…</Centered>;
  if (error || !d) return (
    <Centered>
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-2 text-[#b45309]" />
        <p className="font-semibold text-[#14201a]">{error ?? 'Contract not available'}</p>
        <Link href={`/portal/${token}`} className="text-sm text-[#047246] mt-2 inline-block">← Back</Link>
      </div>
    </Centered>
  );

  const ejari = toEjari(d.contract, d.signatures);
  // Combine the addendum into the contract PDF the tenant reads/signs.
  const addendums: EjariAddendum[] = d.addendums ?? [];

  // System-generated payment receipts (proof of payment) — the same generator the
  // RP / landlord views use, fed from the token-scoped plan the backend now returns
  // on the customer link. Shown only when there are payment / fee rows to receipt.
  const receipt: ReceiptContract | null =
    d.plan && (d.plan.payments.length > 0 || (d.plan.fees?.length ?? 0) > 0)
      ? ({
          ...d.contract, payments: d.plan.payments, fees: d.plan.fees, pdcConfirmed: d.pdcConfirmed,
          paymentRefs: shapePaymentRefs(d.paymentRefs ?? {}),
        } as unknown as ReceiptContract)
      : null;

  // The Contract Registration certificate the landlord or manager uploaded onto
  // this contract. Every variant of the key is `ejari*` (`ejari_certificate`,
  // plus the upload-timestamp-suffixed slots the RP page mints for re-uploads),
  // so match on the prefix and take the most recent one on file.
  const ejariCert = [...d.documents].reverse().find(doc => /^ejari/i.test(doc.documentKey) && !!doc.fileUrl) ?? null;

  // Every download off this link is named the same way, so the files identify
  // themselves in the customer's downloads folder: Receipt-Unit-317-CID-394.pdf.
  const docName = (kind: LeaseDocKind) =>
    leaseDocFileName(kind, { unitNumber: d.contract.unit?.number, ref: `CID-${d.contract.id}` });

  // Landlord links get a dedicated layout: the contract + every document in full
  // preview (no download) with a sticky sign menu — the lessor's equivalent of
  // the customer review-and-sign page.
  if ((d.signerRole ?? 'tenant') === 'landlord') {
    return <LandlordReview token={token} id={id} d={d} ejari={ejari} addendums={addendums} onSigned={load} />;
  }

  // Each link is scoped to one action; 'all' = legacy link that shows everything.
  const purpose = d.purpose ?? 'all';
  const isInspector = (d.signerRole ?? 'tenant') === 'inspector';
  // While the redirect effect above navigates the inspector to the form, show a
  // loader instead of flashing the contract review they don't need to see.
  if (isInspector && inspType) {
    return <Centered><Loader2 className="animate-spin" /> Opening inspection…</Centered>;
  }
  const showContract = (purpose === 'contract' || purpose === 'all') && !isInspector;
  // Inspector links must reach the fill workspace even before any move-in
  // inspection exists — moveInAvailable stays false until the first save, but
  // generating that inspection on site is exactly the inspection manager's job.
  // Tenants still only see the move-in section once the RP has recorded one.
  const showMoveIn = (purpose === 'move_in' || purpose === 'all') && (d.moveInAvailable || isInspector);
  const showMoveOut = purpose === 'move_out';

  // Meta for the shared v2 inspection report — the magic-link now renders the SAME
  // component as the logged-in customer page. Tenant view: money + per-item photos
  // are already stripped server-side (getInspectionForTenant).
  const reportMeta: ReportMeta = {
    property: d.contract.property?.buildingName ?? d.contract.property?.fullAddress ?? '',
    unitNo: d.contract.unit?.number ?? '',
    propertyType: d.contract.unit?.type ?? '',
    floor: (d.contract.unit as { floor?: string | number | null } | undefined)?.floor != null ? String((d.contract.unit as { floor?: string | number }).floor) : '',
    tenantName: d.contract.tenant?.companyName || d.contract.tenant?.name || '',
    tenantPhone: (d.contract.tenant as { phone?: string | null })?.phone ?? '',
    tenantEmail: (d.contract.tenant as { email?: string | null })?.email ?? '',
    inspectorName: insp?.inspectorName ?? '',
    inspectorCompany: (insp as { inspectorCompany?: string } | null)?.inspectorCompany ?? '',
    inspectorRole: (insp as { inspectorRole?: string } | null)?.inspectorRole ?? 'Property Representative',
  };

  return (
    <div className="min-h-screen bg-[#f7f6f2]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href={`/portal/${token}`} className="text-xs text-[#5f6b63] flex items-center gap-1 mb-3"><ArrowLeft size={13} /> Back to documents</Link>
        <div className="flex items-center gap-2 mb-1"><ShieldCheck size={18} className="text-[#047246]" /><span className="font-bold text-[#14201a]">UpNow</span></div>
        <h1 className="text-2xl font-bold text-[#14201a] mt-3">
          {inspType === 'move_out' ? 'Move-out inspection' : inspType === 'move_in' ? 'Move-in inspection' : 'Your tenancy contract'} — CID-{d.contract.id}
        </h1>
        <p className="text-sm text-[#5f6b63] mt-1">
          {inspType
            ? 'Review the condition your rental provider recorded, then sign at the bottom to confirm.'
            : d.tenantSigned
              ? 'You have signed this contract. Your documents are below — view or download a copy any time, no login needed.'
              : 'Please read the full contract below, then sign at the bottom.'}
        </p>

        {/* Inspection links show the inspection the RP recorded; contract links
             show the contract document — but only until it has been signed. Once
             signed there is nothing left to read and agree to, so the contract
             moves to "Your documents" below as a view / download action instead
             of a wall of PDF the customer has already accepted. */}
        {(inspType || !d.tenantSigned) && (
        <div className="mt-5">
          {inspType ? (
            insp && insp.rpSubmittedAt ? (
              /* Same canvas treatment as the tenancy contract below: the report is
                 the DOCUMENT, scaled to the viewport, not a responsive layout that
                 reflows on a phone. Signing happens in the card further down. */
              <InspectionInline
                doc={insp as unknown as InspectionDoc}
                meta={reportMeta}
                phase={inspType}
                contractRef={`CID-${d.contract.id}`}
                inspectionDate={(insp as { reportGeneratedDate?: string; inspectionDate?: string }).reportGeneratedDate
                  ?? (insp as { inspectionDate?: string }).inspectionDate ?? null}
                moveInDate={d.contract.startDate ?? null}
                moveOutDate={d.contract.endDate ?? null}
              />
            ) : (
              <div className="bg-white rounded-2xl border border-[#e4e9e5] p-8 text-center text-sm text-[#8a948d]">
                {isInspector
                  ? 'No inspection recorded yet — fill the inspection form below to get started.'
                  : 'Your rental provider hasn’t completed this inspection yet. Please check back once they share it.'}
              </div>
            )
          ) : (
            <EjariInline data={ejari} addendums={addendums} noScroll />
          )}
        </div>
        )}

        {/* The photos behind the report — the customer sees what was recorded
             before agreeing to it. On a move-out link the move-in set is shown
             too, as the "before" reference. */}
        {inspType && insp?.rpSubmittedAt && (
          <>
            <InspectionPhotosCard title={inspType === 'move_out' ? 'Move-out photos' : 'Move-in photos'} photos={insp.photos ?? []} />
            {inspType === 'move_out' && (
              <InspectionPhotosCard title="Move-in photos" hint="Recorded at move-in, for reference." photos={insp.moveInPhotos ?? []} />
            )}
          </>
        )}

        {/* Sign the contract */}
        {showContract && (
          <Card title="Sign the contract" icon={PenLine}>
            {d.tenantSigned ? (
              <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> You have signed this contract.</p>
            ) : (
              // Company stamp (0258): offered on commercial leases — required
              // for a company customer, optional for an individual. Mirrors
              // the sign endpoint's rule (companyName covers old company rows
              // that predate entity_type).
              <SignBox token={token} contractId={id} kind="contract" defaultName={d.contract.tenant?.name ?? ''}
                stamp={effectiveSpaceCategory(d.contract.unit?.type, d.contract.property?.spaceCategory) !== 'residential'
                  ? { required: d.contract.tenant?.entityType === 'company' || !!d.contract.tenant?.companyName } : null}
                onSigned={load} />
            )}
          </Card>
        )}

        {/* Available to download — the ONLY three things this link hands over,
             each as a View / Download action rather than an inline preview: the
             payment receipts, the tenancy contract itself, and the Contract
             Registration certificate the landlord or manager uploaded. Each row
             appears only once that document actually exists for this lease, so
             the card grows with the tenancy instead of listing dead entries.
             Contract links only — inspection links are a sign-the-inspection
             surface, not a document hand-over. */}
        {!inspType && (receipt || d.tenantSigned || ejariCert) && (
          <Card title="Available to download" icon={FileText}>
            {/* All three behave identically: the row opens the document in a new
                 tab to read, and a Download control beside it saves it straight
                 to disk under a self-describing name. The two we generate hand
                 over their blob URL; the certificate is a stored file, so its
                 save goes through the token-scoped endpoint (a cross-origin
                 signed URL ignores the anchor's `download` attribute — the name
                 has to come from the server's Content-Disposition). */}
            <div className="space-y-2.5">
              {receipt && (
                <ReceiptButtons contract={receipt} trigger={(_open, _ready, url) => (
                  <DocRow title="Payment receipts" icon={FileText} href={url}
                    download={{ url, fileName: docName('Receipt') }} />
                )} />
              )}
              {/* Only once signed: before that the full contract is previewed
                   right above for reading, so this row would just repeat it. */}
              {d.tenantSigned && (
                <ContractButtons data={ejari} addendums={addendums}
                  trigger={(_open, _ready, url) => (
                    <DocRow title="Tenancy contract" icon={FileText} href={url}
                      download={{ url, fileName: docName('Tenancy-Contract') }} />
                  )} />
              )}
              {ejariCert && (
                <DocRow title="Contract Registration certificate" icon={Stamp} href={ejariCert.fileUrl}
                  download={ejariCert.id != null ? { documentId: ejariCert.id, portalToken: token } : undefined} />
              )}
            </div>
          </Card>
        )}

        {/* Inspector: fill / edit the inspection itself from this link — the
             on-site inspection manager records the condition, then the customer
             signs, then the inspector counter-signs below. */}
        {isInspector && (showMoveIn || showMoveOut) && !insp?.rpCounterSig && (
          <div className="bg-white rounded-2xl border border-[#e4e9e5] mt-4 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#14201a]">{insp?.rpSubmittedAt ? 'Inspection recorded' : 'Start with the inspection form'}</p>
              <p className="text-xs text-[#5f6b63] mt-0.5">
                {insp?.rpSubmittedAt
                  ? 'The form is submitted. You can still review it before counter-signing.'
                  : 'Walk the unit and record the condition room by room — photos included.'}
              </p>
            </div>
            <Link href={`/portal/${token}/contract/${id}/inspection?type=${showMoveOut ? 'move_out' : 'move_in'}`}
              className="text-xs font-semibold px-4 py-2 rounded-xl text-white bg-[#047246] inline-flex items-center gap-1.5 shrink-0">
              <PenLine size={13} /> {insp?.rpSubmittedAt ? 'Open inspection form' : 'Fill the inspection'}
            </Link>
          </div>
        )}

        {showMoveIn && (
          <Card title={isInspector ? 'Counter-sign the move-in inspection' : 'Sign the move-in inspection'} icon={CheckCircle2}>
            {!insp || !insp.rpSubmittedAt ? (
              <p className="text-sm text-[#8a948d]">{isInspector ? 'Fill and submit the inspection form above first.' : 'Not ready to sign yet — your rental provider is still completing the inspection.'}</p>
            ) : isInspector ? (
              insp.rpCounterSig ? (
                <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> This inspection has been counter-signed.</p>
              ) : !insp.tenantSig ? (
                <p className="text-sm text-[#8a948d]">Waiting for the customer to sign first — you counter-sign after them.</p>
              ) : (
                <>
                  <p className="text-xs text-[#5f6b63] mb-2">You are signing as the inspection manager, on behalf of the rental provider. Confirm the condition recorded above, then sign — this completes the move-in.</p>
                  <SignBox token={token} contractId={id} kind="move_in" asInspector defaultName="" onSigned={() => { load(); loadInsp(); }} />
                </>
              )
            ) : insp.tenantSig ? (
              <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> You have signed this move-in inspection.</p>
            ) : (
              <>
                <p className="text-xs text-[#5f6b63] mb-2">Confirm the condition recorded above, then sign.</p>
                <SignBox token={token} contractId={id} kind="move_in" defaultName={d.contract.tenant?.name ?? ''} onSigned={() => { load(); loadInsp(); }} />
              </>
            )}
          </Card>
        )}

        {showMoveOut && (
          <Card title={isInspector ? 'Counter-sign the move-out inspection' : 'Sign the move-out inspection'} icon={CheckCircle2}>
            {!insp || !insp.rpSubmittedAt ? (
              <p className="text-sm text-[#8a948d]">{isInspector ? 'Fill and submit the inspection form above first.' : 'Not ready to sign yet — your rental provider is still completing the move-out inspection.'}</p>
            ) : isInspector ? (
              insp.rpCounterSig ? (
                <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> This inspection has been counter-signed.</p>
              ) : !insp.tenantSig ? (
                <p className="text-sm text-[#8a948d]">Waiting for the customer to sign first — you counter-sign after them.</p>
              ) : (
                <>
                  <p className="text-xs text-[#5f6b63] mb-2">You are signing as the inspection manager, on behalf of the rental provider. Confirm the move-out condition recorded above, then sign.</p>
                  <SignBox token={token} contractId={id} kind="move_out" asInspector defaultName="" onSigned={() => { load(); loadInsp(); }} />
                </>
              )
            ) : insp.tenantSig ? (
              <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> You have signed this move-out inspection.</p>
            ) : (
              <>
                <p className="text-xs text-[#5f6b63] mb-2">Confirm the move-out condition recorded above, then sign.</p>
                <SignBox token={token} contractId={id} kind="move_out" defaultName={d.contract.tenant?.name ?? ''} onSigned={() => { load(); loadInsp(); }} />
              </>
            )}
          </Card>
        )}

        <p className="text-xs text-[#8a948d] text-center mt-6 mb-4">Powered by UpNow.</p>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center gap-2 text-[#5f6b63] text-sm bg-[#f7f6f2] p-6">{children}</div>;
}
function Card({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e4e9e5] mt-4 overflow-hidden">
      <div className="px-5 py-3 border-b border-[#eef1ef] bg-[#f6f8f6] flex items-center gap-2">
        <Icon size={15} className="text-[#047246]" /><span className="text-sm font-bold text-[#14201a]">{title}</span>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

/** One document in the portal's "Available to download" card — the same jade
 *  tile-and-title row the customer sees on their dashboard. The row itself opens
 *  the file in a new tab to read; the Download button beside it saves straight to
 *  disk without previewing first. `href` is null only while a generated PDF is
 *  still rendering, which the row says plainly.
 *
 *  The two controls are SIBLINGS, never nested — a <button> inside an <a> is
 *  invalid and swallows one of the two clicks. */
function DocRow({ title, icon: Icon, href, download }: {
  title: string; icon: React.ComponentType<{ size?: number }>; href: string | null;
  /** A same-origin blob to save directly, or a stored document to fetch a named
   *  attachment URL for through the token-scoped endpoint. */
  download?: { url: string | null; fileName: string } | { documentId: number; portalToken: string };
}) {
  const dlCls = 'text-xs font-semibold px-3 py-2 rounded-xl text-[#1f6f54] bg-white border border-[#cfe9e0] cursor-pointer whitespace-nowrap no-underline shrink-0 self-start sm:self-auto ml-12 sm:ml-0';
  const blob = download && 'url' in download ? download : null;
  const stored = download && 'documentId' in download ? download : null;
  return (
    // Stacks on phones — side by side, a wrapped title pushes the "opens in a new
    // tab" arrow straight into the Download button.
    <div className="rounded-2xl border border-[#047246] bg-[#fbfaf8] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
      {/* Read: opens in a new tab. */}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 min-w-0 sm:flex-1 no-underline cursor-pointer">
          <span className="w-9 h-9 rounded-xl bg-[#047246] text-white grid place-items-center shrink-0"><Icon size={18} /></span>
          <span className="text-sm font-bold text-[#14201a] min-w-0">{title}</span>
          <ExternalLink size={14} className="text-[#1f6f54] shrink-0" />
        </a>
      ) : (
        <span className="flex items-center gap-3 min-w-0 sm:flex-1 opacity-70">
          <span className="w-9 h-9 rounded-xl bg-[#047246] text-white grid place-items-center shrink-0"><Icon size={18} /></span>
          <span className="text-sm font-bold text-[#14201a] min-w-0">{title}</span>
          <span className="text-xs text-[#8a948d] whitespace-nowrap">⏳ Preparing…</span>
        </span>
      )}
      {/* Save: straight to disk, correctly named, no preview step. */}
      {blob && (blob.url
        ? <a href={blob.url} download={blob.fileName} className={dlCls}>⬇ Download</a>
        : <span className={`${dlCls} opacity-50`}>⬇ Download</span>)}
      {stored && (
        <DownloadDocButton documentId={stored.documentId} portalToken={stored.portalToken}
          label="Download" className={dlCls} />
      )}
    </div>
  );
}

function SignBox({ token, contractId, kind, defaultName, onSigned, asInspector = false, stamp = null }: {
  token: string; contractId: number; kind: 'contract' | 'move_in' | 'move_out'; defaultName: string; onSigned: () => void; asInspector?: boolean;
  /** Company-stamp section (contract signing on commercial leases only). */
  stamp?: { required: boolean } | null;
}) {
  const isContract = kind === 'contract';
  const moveLabel = kind === 'move_out' ? 'move-out' : 'move-in';
  const termsText = isContract
    ? 'I have read the contract above and agree to its terms.'
    : `I confirm the condition recorded in this ${moveLabel} inspection is accurate.`;
  const submitLabel = isContract ? 'Sign contract'
    : asInspector ? (kind === 'move_out' ? 'Counter-sign move-out' : 'Counter-sign move-in')
    : (kind === 'move_out' ? 'Sign move-out' : 'Sign move-in');

  const onSign = async (p: SignaturePayload) => {
    const url = isContract ? `/contracts/${contractId}/sign`
      : asInspector ? `/contracts/${contractId}/inspection/counter-sign`
      : `/contracts/${contractId}/inspection/sign`;
    const body = isContract
      ? { signatureImage: p.signatureImage, signatoryName: p.signatoryName, consent: p.consent, clientMeta: p.clientMeta, geo: p.geo, stampImage: p.stampImage ?? null }
      : { type: kind === 'move_out' ? 'move_out' : 'move_in', signatureImage: p.signatureImage, signatoryName: p.signatoryName, consent: p.consent, clientMeta: p.clientMeta, geo: p.geo };
    const res = await fetch(API(token, url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.message || 'Could not sign'); }
    onSigned();
  };

  return (
    <SignatureBlock
      signerRole={asInspector ? 'Inspector' : 'Customer'}
      signerName={defaultName}
      onBehalfOf={asInspector ? 'the rental provider' : null}
      defaultName={defaultName}
      termsText={termsText}
      submitLabel={submitLabel}
      alreadySigned={false}
      stamp={isContract ? stamp : null}
      onSign={onSign}
    />
  );
}

/** Landlord review-and-sign: renders the SAME full-page binder as the RP's
 *  authenticated "View all" page, fed from the token-scoped portal payload.
 *  Reached only via a signerRole='landlord' magic link. */
function LandlordReview({ token, id, d, ejari, addendums, onSigned }: {
  token: string; id: number; d: Detail; ejari: EjariContractData; addendums: EjariAddendum[]; onSigned: () => void;
}) {
  const landlordName = d.contract.landlord?.companyName || d.contract.landlord?.name || 'Landlord';
  // When the landlord has a Power of Attorney holder on file, the lessor
  // signature is legally the POA holder's — show them "on behalf of" the
  // landlord (matches the authenticated surfaces + the backend stamp).
  const poaHolder = d.contract.landlord?.hasPoa && d.contract.landlord?.poaPersonName?.trim() ? d.contract.landlord.poaPersonName.trim() : null;
  // Stamp the landlord's identity + the moment opened into every preview, once.
  const [watermark] = useState(() =>
    `${landlordName} — Confidential · ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);

  const documents: BinderDoc[] = (d.allDocuments ?? []).map((doc, i) => ({
    // Real document id (needed for the token-scoped download); synthetic rows
    // (cheque images) arrive with a negative id — fall back to index only if absent.
    id: doc.id ?? i + 1, documentKey: doc.documentKey, displayName: doc.displayName, fileUrl: doc.fileUrl,
    category: doc.category ?? null, ownerType: doc.ownerType,
    // The RP's declared section decides the pane — see resolveDocSection.
    section: doc.section ?? null,
    // The recorded Show choice must survive this mapping: the renewal pane
    // keeps a non-core KYC document only when portalHidden === false, and
    // dropping the field here silently re-hid it on the landlord link while
    // the RP page showed it — the views MUST stay consistent.
    portalHidden: doc.portalHidden ?? null,
  }));
  const planContract: PlanContract = {
    contractType: d.contract.contractType,
    annualRent: d.contract.annualRent,
    rentVatRate: d.rentVatRate ?? 0,
    discountAmount: d.contract.discountAmount,
    listedRent: d.contract.listedRent,
    numberOfInstallments: d.contract.numberOfInstallments,
    securityDepositAmount: d.contract.securityDepositAmount,
    fees: d.plan?.fees ?? [],
  };
  const receipt = d.plan
    ? ({ ...d.contract, payments: d.plan.payments, fees: d.plan.fees, pdcConfirmed: d.pdcConfirmed } as unknown as ReceiptContract)
    : null;
  // Same issued numbers the RP sees — the binder merges these into the receipt.
  const paymentRefs = shapePaymentRefs(d.paymentRefs ?? {});

  const sign = async ({ signatureImage, signatoryName }: { signatureImage: string; signatoryName: string }) => {
    const res = await fetch(API(token, `/contracts/${id}/sign-landlord`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // consent: the binder's ContractSignBar gates signing behind its
      // review-and-agree checkbox, so reaching here means it was ticked.
      body: JSON.stringify({ signatureImage, signatoryName, consent: true, clientMeta: collectClientMeta(), geo: await collectGeo() }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.message || 'Could not sign'); }
    onSigned();
  };

  return (
    <ContractDocsBinder
      refLabel={`CID-${d.contract.id}`}
      contractType={d.contract.contractType}
      ended={d.contract.status === 'terminated'}
      documents={documents}
      tenant={d.contract.tenant}
      ejari={ejari}
      addendums={addendums}
      planContract={planContract}
      planPayments={d.plan?.payments ?? []}
      paymentRefs={paymentRefs}
      receipt={receipt}
      watermark={watermark}
      portalToken={token}
      signerName={poaHolder ?? landlordName}
      signerOnBehalfOf={poaHolder ? landlordName : undefined}
      signerDefaultName={poaHolder ?? d.contract.landlord?.name ?? d.contract.landlord?.companyName ?? ''}
      landlordSigned={!!d.landlordSigned}
      onSign={sign}
    />
  );
}

function condMeta(v?: string): { label: string; cls: string } {
  if (v === 'G') return { label: 'Good', cls: 'bg-[#047246] text-white' };
  if (v === 'F') return { label: 'Fair', cls: 'bg-[#f59e0b] text-white' };
  if (v === 'D') return { label: 'Damaged', cls: 'bg-[#ef4444] text-white' };
  return { label: '—', cls: 'bg-[#f0efe9] text-[#8a948d]' };
}

function PhotoGrid({ photos }: { photos: InspPhoto[] }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {photos.map(p => (
        <button key={p.id} type="button" onClick={() => openDocViewer({ fileUrl: p.url, caption: p.caption })} className="block w-full rounded-lg overflow-hidden border border-[#e4e9e5] cursor-pointer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={p.caption || 'photo'} className="w-full h-20 object-cover" />
        </button>
      ))}
    </div>
  );
}

/** Read-only inspection report the tenant reviews before signing on the portal. */
function InspectionPreview({ insp, type }: { insp: Inspection; type: 'move_in' | 'move_out' }) {
  const isOut = type === 'move_out';
  // Single condition column for both flows — the move-out view shows only the
  // move-out condition (the move-in reference column is intentionally omitted).
  const cols = 'grid-cols-[1fr_5rem]';
  const Pill = ({ v }: { v?: string }) => {
    const m = condMeta(v);
    return <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
  };
  return (
    <div className="space-y-4">
      {/* Condition legend */}
      <div className="flex items-center gap-3 bg-[#f9f8f6] rounded-xl px-4 py-2.5 text-xs">
        <span className="font-semibold text-[#5f6b63] uppercase tracking-wide">Condition</span>
        <span className="inline-flex items-center gap-1.5"><Pill v="G" /></span>
        <span className="inline-flex items-center gap-1.5"><Pill v="F" /></span>
        <span className="inline-flex items-center gap-1.5"><Pill v="D" /></span>
      </div>

      {(insp.areas ?? []).map((area, ai) => (
        <div key={ai} className="bg-white rounded-2xl border border-[#e4e9e5] overflow-hidden">
          <div className="px-5 py-3 bg-[#f6f8f6] border-b border-[#eef1ef]">
            <span className="text-sm font-bold text-[#14201a]">{area.name || `Area ${ai + 1}`}</span>
          </div>
          <div className="px-5 py-3">
            <div className={`grid ${cols} gap-3 pb-1.5 border-b border-[#eef1ef] text-[10px] font-semibold uppercase tracking-wide text-[#8a948d]`}>
              <span>Item</span>
              <span className="text-center">{isOut ? 'Move-out' : 'Condition'}</span>
            </div>
            {(area.items ?? []).map((it, ii) => (
              <div key={ii} className={`grid ${cols} gap-3 items-center py-1.5 border-b border-[#f9f8f6] last:border-0`}>
                <span className="text-sm text-[#14201a]">{it.name}</span>
                <span className="text-center"><Pill v={isOut ? it.outCondition : it.inCondition} /></span>
              </div>
            ))}
            {area.remarks && <p className="text-xs text-[#5f6b63] mt-2"><span className="font-semibold">Remarks:</span> {area.remarks}</p>}
          </div>
        </div>
      ))}

      {insp.generalNotes && (
        <div className="bg-white rounded-2xl border border-[#e4e9e5] p-4">
          <p className="text-xs font-semibold text-[#14201a] mb-1">General notes</p>
          <p className="text-sm text-[#5f6b63] whitespace-pre-wrap">{insp.generalNotes}</p>
        </div>
      )}

      {(isOut && (insp.moveInPhotos ?? []).length > 0) || (insp.photos ?? []).length > 0 ? (
        <div className="bg-white rounded-2xl border border-[#e4e9e5] p-4 space-y-3">
          {isOut && (insp.moveInPhotos ?? []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#8a948d] mb-1.5">Move-in photos (reference)</p>
              <PhotoGrid photos={insp.moveInPhotos!} />
            </div>
          )}
          {(insp.photos ?? []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#14201a] mb-1.5">{isOut ? 'Move-out photos' : 'Move-in photos'}</p>
              <PhotoGrid photos={insp.photos!} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
