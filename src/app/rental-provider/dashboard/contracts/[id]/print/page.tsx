/**
 * RP / landlord-side contract print page.
 *
 * Renders the Dubai Unified Tenancy Contract as a real vector PDF via
 * @react-pdf/renderer — the SAME <EjariContractViewer> used on the customer side,
 * so both portals produce a byte-for-byte identical contract. Loaded client-only
 * because the PDF viewer needs the browser. Includes addendum pages with signatures.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';

function FullScreenLoader() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#52555a' }}>
      <Loader2 className="animate-spin" size={36} style={{ color: '#fff' }} />
    </div>
  );
}

// @react-pdf must run client-side only.
const EjariContractViewer = dynamic(() => import('@/components/contract/EjariContractPdf'), {
  ssr: false,
  loading: () => <FullScreenLoader />,
});

/** Map the RP-side contract detail (+ separate signatures) into the shared EjariContractData. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEjari(c: any, signatures: any[]): EjariContractData {
  return {
    ref: c.ref,
    startDate: c.startDate,
    endDate: c.endDate,
    createdAt: c.createdAt,
    annualRent: c.annualRent,
    contractValue: c.contractValue ?? null,
    listedRent: c.listedRent ?? null,
    discountType: c.discountType ?? null,
    discountAmount: c.discountAmount ?? null,
    // Effective held deposit (chain-resolved on renewals) → falls back to the field.
    securityDepositAmount: c.securityDepositHeld ?? c.securityDepositAmount ?? null,
    modeOfPayment: c.modeOfPayment ?? null,
    numberOfInstallments: c.numberOfInstallments ?? null,
    customClauses: c.customClauses ?? [],
    notes: c.notes ?? null,
    landlord: {
      name: c.landlord?.name ?? null,
      email: c.landlord?.email ?? null,
      phone: c.landlord?.phone ?? null,
      companyName: c.landlord?.companyName ?? null,
      emiratesId: c.landlord?.emiratesId ?? null,
      licenseNumber: c.landlord?.licenseNumber ?? null,
      licenseAuthority: c.landlord?.licenseAuthority ?? null,
    },
    tenant: {
      name: c.tenant?.name ?? null,
      email: c.tenant?.email ?? null,
      phone: c.tenant?.phone ?? null,
      emiratesId: c.tenant?.emiratesId ?? null,
      licenseNumber: c.tenant?.licenseNumber ?? null,
      licenseAuthority: c.tenant?.licenseAuthority ?? null,
    },
    property: {
      buildingName: c.property?.buildingName ?? null,
      fullAddress: c.property?.fullAddress ?? null,
      community: c.property?.community ?? null,
      emirate: c.property?.emirate ?? null,
      plotNumber: c.property?.plotNumber ?? null,
      makaniNumber: c.property?.makaniNumber ?? null,
      premisesNumber: c.property?.premisesNumber ?? null,
      spaceCategory: c.property?.spaceCategory ?? null,
    },
    unit: {
      number: c.unit?.number ?? null,
      name: c.unit?.name ?? null,
      type: c.unit?.type ?? null,
      sizeSqm: c.unit?.sizeSqm ?? null,
      dewaPremiseNumber: c.unit?.dewaPremiseNumber ?? null,
      bedrooms: c.unit?.bedrooms ?? null,
    },
    signatures: (Array.isArray(signatures) ? signatures : []).map((s) => ({
      role: s.role,
      signatureImage: s.signatureImage ?? null,
      signedAt: s.signedAt,
      method: s.method,
    })),
  };
}

export default function ContractPrintPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<EjariContractData | null>(null);
  const [addendums, setAddendums] = useState<EjariAddendum[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const [c, sigs, aRaw] = await Promise.all([
          fetch(`/api/contracts/${params.id}`, { credentials: 'include' }).then((r) => {
            if (!r.ok) throw new Error(`Error ${r.status}`);
            return r.json();
          }),
          fetch(`/api/contracts/${params.id}/signatures`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
          fetch(`/api/contracts/${params.id}/addendums`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
        ]);

        const adds: EjariAddendum[] = Array.isArray(aRaw) ? aRaw : [];
        // For DOCX addendums, extract the text so it renders inline in the PDF.
        const enriched = await Promise.all(
          adds.map(async (a) => {
            // Text addendums (in-app terms) have no file — render via a.terms; skip mammoth.
            const isDocx = (a.mimeType || '').includes('word') || /\.docx?$/i.test(a.fileUrl || '');
            if (!isDocx || !a.fileUrl) return a;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const mod: any = await import('mammoth/mammoth.browser');
              const mammoth = mod.default ?? mod;
              const buf = await (await fetch(a.fileUrl)).arrayBuffer();
              const out = await mammoth.extractRawText({ arrayBuffer: buf });
              const lines = String(out.value || '').split(/\n+/).map((s: string) => s.trim()).filter(Boolean);
              return lines.length ? { ...a, lines } : a;
            } catch {
              return a; // fall back to a reference line if the file can't be read
            }
          }),
        );

        if (!cancelled) {
          setData(toEjari(c, sigs));
          setAddendums(enriched);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();

    return () => { cancelled = true; };
  }, [params?.id]);

  if (error) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', color: '#c00', padding: 32 }}>
        Failed to load contract: {error}
      </div>
    );
  }
  if (!data) return <FullScreenLoader />;

  return <EjariContractViewer data={data} addendums={addendums} />;
}
