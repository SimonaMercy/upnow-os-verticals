/**
 * Tenant-facing inspection viewer + signer. Renders the shared InspectionReportView
 * read-only (audience='customer' — no amounts), exactly as the RP/manager workspace
 * renders it, and lets the tenant counter-sign from a SEPARATE card below the
 * report — the signing pad is never injected into the report's signature grid.
 * Signature posts to POST /contracts/tenant/:id/inspection/sign?type=...
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ReportMeta } from '@/components/contract/InspectionReportView';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import type { InspectionDoc, InspectionCategory } from '@/lib/inspectionCatalog';
import { InspectionPhotosCard } from '@/components/contract/InspectionPhotosCard';

// @react-pdf + pdf.js are browser-only.
const InspectionInline = dynamic(() => import('@/components/contract/InspectionInline'), {
  ssr: false,
  loading: () => (
    <div className="border border-[#e8e6e0] rounded-xl bg-white h-[360px] grid place-items-center text-sm text-[#9b9890]">
      Preparing inspection report…
    </div>
  ),
});

function BackLink({ contractId }: { contractId: string | undefined }) {
  const sp = useSearchParams();
  const from = sp.get('from');
  const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : null;
  const href = safeFrom ?? (contractId ? `/dashboard/customer/spaces/v2/c-${contractId}` : '/dashboard/customer/spaces');
  return (
    <Link href={href} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] w-fit">
      <ArrowLeft size={15} /> Back to my space
    </Link>
  );
}

type InspType = 'move_in' | 'move_out';

interface InspectionData {
  reportGeneratedDate?: string;
  inspectorName?: string;
  inspectorCompany?: string;
  inspectorRole?: string;
  inspectionDate?: string;
  moveInDate?: string;
  categories?: InspectionCategory[];
  generalNotes?: string;
  /** Walk-through photos (re-signed URLs). Per-item evidence is RP-only and never sent here. */
  photos?: { id: string; url: string; caption?: string }[];
  moveInPhotos?: { id: string; url: string; caption?: string }[];
  tenantSig: string | null;
  tenantSignedAt?: string | null;
  rpCounterSig?: string | null;
  rpCounterSignedAt?: string | null;
}
interface InspMeta {
  tenantName: string; tenantPhone: string; tenantEmail: string;
  unitNumber: string; buildingName: string; propertyType: string; floor: string;
  handoverDate: string | null; contractEndDate: string | null;
}

/** Inline signature canvas. */
export default function TenantInspectionPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const contractId = Number(params.id);
  const inspType = (searchParams.get('type') === 'move_out' ? 'move_out' : 'move_in') as InspType;

  const [data, setData] = useState<InspectionData | null>(null);
  const [meta, setMeta] = useState<InspMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true); setLoadError(null);
    try {
      // The contract DETAIL endpoint (not the list) — it carries the unit type,
      // floor and the customer's email, so the report's Property / Tenant cards
      // read exactly like the RP/manager copy instead of showing dashes.
      const [res, cRes] = await Promise.all([
        fetch(`/api/contracts/tenant/${contractId}/inspection?type=${inspType}`, { credentials: 'include' }),
        fetch(`/api/contracts/tenant/${contractId}`, { credentials: 'include' }),
      ]);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setLoadError((b as { message?: string }).message ?? 'Failed to load inspection');
        return;
      }
      const body = await res.json() as InspectionData | null;
      if (!body) { setLoadError('The rental provider has not submitted this inspection yet.'); return; }
      setData(body);
      if (body.tenantSig) setSigned(true);
      try {
        const c = cRes.ok ? await cRes.json() : null;
        // Company tenants: the party name is the company, not the signatory.
        const tenantName = (c?.tenant?.companyName as string | undefined)?.trim() || (c?.tenant?.name ?? '').trim();
        setMeta({
          tenantName,
          tenantPhone: c?.tenant?.phone ?? '',
          tenantEmail: c?.tenant?.email ?? '',
          unitNumber: c?.unit?.number ?? '',
          // "Building, Community" — same location string the RP/manager copy shows.
          buildingName: [c?.property?.buildingName ?? '', c?.property?.community ?? ''].filter(Boolean).join(', '),
          propertyType: c?.unit?.type ?? '',
          floor: c?.unit?.floor != null ? String(c.unit.floor) : '',
          handoverDate: body.moveInDate || c?.startDate || null,
          contractEndDate: c?.termination?.effectiveDate ?? c?.endDate ?? null,
        });
      } catch { /* header best-effort */ }
    } catch {
      setLoadError('Unexpected error loading inspection');
    } finally { setLoading(false); }
  }, [contractId, inspType]);
  useEffect(() => { void load(); }, [load]);

  async function handleSign(p: SignaturePayload) {
    const res = await fetch(`/api/contracts/tenant/${contractId}/inspection/sign?type=${inspType}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureImage: p.signatureImage, signatoryName: p.signatoryName, consent: p.consent, clientMeta: p.clientMeta, geo: p.geo }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? 'Failed to submit signature');
    }
    setSigned(true);
    void load();
  }

  if (loading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="animate-spin text-[#2e9f82]" size={28} /></div>;
  }
  if (loadError || !data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <BackLink contractId={params?.id} />
        <div style={{ height: 16 }} />
        <div className="bg-[#fff7ed] border border-[#fed7aa] rounded-2xl p-5 flex items-start gap-3">
          <AlertCircle size={18} className="text-[#c2410c] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#9a3412]">Inspection not available</p>
            <p className="text-xs text-[#c2410c] mt-0.5">{loadError ?? 'No inspection has been submitted yet.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const reportMeta: ReportMeta = {
    property: meta?.buildingName ?? '', unitNo: meta?.unitNumber ?? '',
    propertyType: meta?.propertyType ?? '', floor: meta?.floor ?? '',
    tenantName: meta?.tenantName ?? '', tenantPhone: meta?.tenantPhone ?? '', tenantEmail: meta?.tenantEmail ?? '',
    inspectorName: data.inspectorName ?? '', inspectorCompany: data.inspectorCompany ?? '', inspectorRole: data.inspectorRole ?? 'Property Representative',
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8" id="inspection-report">
      {/* No Preview / Download / Print here — the customer reads and signs the
          report in place; exporting the document stays an RP/manager action. */}
      <div className="no-print mb-4">
        <BackLink contractId={params?.id} />
      </div>

      {/* The report is the DOCUMENT itself, rasterised to canvas exactly like the
          tenancy contract — it scales to the viewport instead of reflowing into a
          responsive layout on a phone. Signing happens in the card below. */}
      <InspectionInline
        doc={{ ...data, categories: data.categories ?? [] } as unknown as InspectionDoc}
        meta={reportMeta}
        phase={inspType}
        contractRef={`CID-${contractId}`}
        inspectionDate={data.inspectionDate ?? data.reportGeneratedDate ?? null}
        moveInDate={meta?.handoverDate ?? null}
        moveOutDate={meta?.contractEndDate ?? null}
      />

      {/* The photos behind the report — the customer sees what was recorded
          before agreeing to it. Move-out also shows the move-in set as the
          "before" reference. */}
      <div className="no-print">
        <InspectionPhotosCard title={inspType === 'move_out' ? 'Move-out photos' : 'Move-in photos'} photos={data.photos ?? []} />
        {inspType === 'move_out' && (
          <InspectionPhotosCard title="Move-in photos" hint="Recorded at move-in, for reference." photos={data.moveInPhotos ?? []} />
        )}
      </div>

      {!signed && (
        <div className="no-print mt-6 bg-white rounded-2xl border border-[#e8e6e0] p-5">
          <h3 className="text-sm font-bold text-[#1a1916] mb-3">Your Signature</h3>
          <SignatureBlock
            signerRole="Customer"
            signerName={meta?.tenantName ?? ''}
            defaultName={meta?.tenantName ?? ''}
            termsText={`I confirm the condition recorded in this ${inspType === 'move_out' ? 'move-out' : 'move-in'} inspection is accurate and agree to it.`}
            submitLabel="Agree & Sign Inspection"
            alreadySigned={false}
            onSign={handleSign}
          />
        </div>
      )}

      {signed && (
        <div className="no-print mt-5 flex items-center gap-2 bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3">
          <CheckCircle2 size={16} className="text-[#2e9f82]" />
          <p className="text-sm font-medium text-[#1a7a5a]">{data.rpCounterSig ? 'Both parties have signed.' : 'You have signed — awaiting the rental provider counter-signature.'}</p>
        </div>
      )}

      <style jsx global>{`
        @media print { nav, aside, .no-print { display: none !important; } body { background: #fff !important; } #inspection-report { margin: 0 !important; } }
      `}</style>
    </div>
  );
}
