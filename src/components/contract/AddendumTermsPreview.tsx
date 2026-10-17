'use client';

/**
 * Live PDF preview of in-app addendum terms — renders just the addendum page(s)
 * via the real contract renderer (AddendumDoc), so the RP sees the exact output
 * INCLUDING the hardcoded, non-editable <Signatures> block before saving.
 * Rasterised to <canvas> via pdf.js (EjariCanvas) — an <iframe> blob renders blank
 * on mobile browsers / in production. @react-pdf needs the browser → load via
 * next/dynamic with ssr:false.
 */
import { AddendumDoc, type EjariContractData, type EjariAddendum } from './EjariContractPdf';
import { useReactPdfDoc } from './useReactPdfDoc';
import EjariCanvas from './EjariCanvas';
import type { AddendumTerms } from '@/lib/addendumTerms';

// Minimal placeholder contract — AddendumDoc only reads property.emirate (for
// jurisdiction/header) and createdAt. emirate null → defaults to Dubai header.
const PREVIEW_DATA: EjariContractData = {
  ref: 'PREVIEW', startDate: '', endDate: '', createdAt: new Date().toISOString(),
  annualRent: 0, contractValue: null, securityDepositAmount: null, modeOfPayment: null,
  landlord: { name: null, email: null, phone: null },
  tenant: { name: null, email: null, phone: null },
  property: { buildingName: null, fullAddress: null, community: null, emirate: null, plotNumber: null, makaniNumber: null },
  unit: { number: null, name: null, type: null, sizeSqm: null },
};

export default function AddendumTermsPreview({ terms, height = 520 }: { terms: AddendumTerms; height?: number }) {
  const addendum: EjariAddendum = {
    id: 0,
    name: (terms.name && terms.name.trim()) || 'Agreement Addendum',
    tenantSig: null, tenantSignedAt: null, landlordSig: null, landlordSignedAt: null,
    terms,
  };
  // Re-render only when the terms change (their JSON is the stable content key).
  const { bytes, error } = useReactPdfDoc(
    () => <AddendumDoc data={PREVIEW_DATA} addendums={[addendum]} />,
    JSON.stringify(terms),
  );
  const frame = { border: '1px solid #e4e9e5', borderRadius: 12 } as const;
  if (error) return <div style={{ ...frame, height, display: 'grid', placeItems: 'center', color: '#c00', fontSize: 13 }}>Failed to render preview: {error}</div>;
  return <EjariCanvas bytes={bytes} height={height} />;
}
