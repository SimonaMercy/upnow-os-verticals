/**
 * Tenant-facing inspection viewer + signer. Renders the shared InspectionReportView
 * read-only (audience='customer' — no amounts) and lets the tenant counter-sign.
 * Signature posts to POST /contracts/tenant/:id/inspection/sign?type=...
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, Printer } from 'lucide-react';
import { InspectionReportView, type ReportMeta } from '@/components/contract/InspectionReportView';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import type { InspectionDoc, InspectionCategory } from '@/lib/inspectionCatalog';

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
  tenantSig: string | null;
  tenantSignedAt?: string | null;
  rpCounterSig?: string | null;
  rpCounterSignedAt?: string | null;
}
interface InspMeta {
  tenantName: string; tenantPhone: string; unitNumber: string; buildingName: string;
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
      const [res, listRes, meRes] = await Promise.all([
        fetch(`/api/contracts/tenant/${contractId}/inspection?type=${inspType}`, { credentials: 'include' }),
        fetch(`/api/contracts/tenant`, { credentials: 'include' }),
        fetch(`/api/auth/me`, { credentials: 'include' }),
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
        const list = listRes.ok ? (await listRes.json()) : [];
        const c = Array.isArray(list) ? list.find((x: { id: number }) => x.id === contractId) : null;
        const me = meRes.ok ? await meRes.json() : null;
        const composedName = [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim();
        const rawName = (me?.name ?? '').trim();
        const personName = composedName || (/^\+?[\d\s()-]{6,}$/.test(rawName) ? '' : rawName);
        // Company tenants: the party name is the company, not the signatory.
        const tenantName = (c?.tenantCompanyName as string | undefined)?.trim() || personName;
        setMeta({
          tenantName, tenantPhone: me?.phone ?? '',
          unitNumber: c?.unit?.unitNumber ?? c?.unit?.number ?? '',
          buildingName: c?.property?.buildingName ?? '',
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
    property: meta?.buildingName ?? '', unitNo: meta?.unitNumber ?? '', propertyType: '', floor: '',
    tenantName: meta?.tenantName ?? '', tenantPhone: meta?.tenantPhone ?? '', tenantEmail: '',
    inspectorName: data.inspectorName ?? '', inspectorCompany: data.inspectorCompany ?? '', inspectorRole: data.inspectorRole ?? 'Property Representative',
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8" id="inspection-report">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <BackLink contractId={params?.id} />
        <button type="button" onClick={() => window.print()}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef]">
          <Printer size={13} /> Print
        </button>
      </div>

      <InspectionReportView
        doc={{ ...data, categories: data.categories ?? [] } as unknown as InspectionDoc}
        meta={reportMeta}
        phase={inspType}
        audience="customer"
        dates={{ inspectionDate: data.inspectionDate ?? data.reportGeneratedDate ?? null, moveInDate: meta?.handoverDate ?? null, moveOutDate: meta?.contractEndDate ?? null }}
        editable={false}
        generalNotes={data.generalNotes}
        signatures={{ tenantSig: data.tenantSig, tenantSignedAt: data.tenantSignedAt, rpSig: data.rpCounterSig, rpSignedAt: data.rpCounterSignedAt }}
        signSlot={!signed ? (
          <SignatureBlock
            signerRole="Customer"
            signerName={meta?.tenantName ?? ''}
            defaultName={meta?.tenantName ?? ''}
            termsText={`I confirm the condition recorded in this ${inspType === 'move_out' ? 'move-out' : 'move-in'} inspection is accurate and agree to it.`}
            submitLabel="Agree & Sign Inspection"
            alreadySigned={false}
            onSign={handleSign}
          />
        ) : undefined}
      />

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
