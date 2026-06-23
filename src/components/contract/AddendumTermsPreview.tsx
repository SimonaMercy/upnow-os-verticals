'use client';

/**
 * Live PDF preview of in-app addendum terms — renders just the addendum page(s)
 * via the real contract renderer (AddendumDoc), so the RP sees the exact output
 * INCLUDING the hardcoded, non-editable <Signatures> block before saving.
 * @react-pdf needs the browser → load via next/dynamic with ssr:false.
 */
import { PDFViewer } from '@react-pdf/renderer';
import { AddendumDoc, type EjariContractData, type EjariAddendum } from './EjariContractPdf';
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
  return (
    <PDFViewer width="100%" height={height} showToolbar style={{ border: '1px solid #e8e6e0', borderRadius: 12 }}>
      <AddendumDoc data={PREVIEW_DATA} addendums={[addendum]} />
    </PDFViewer>
  );
}
