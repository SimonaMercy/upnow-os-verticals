'use client';

/**
 * Render an in-app addendum to a PDF and open it in a NEW BROWSER TAB — used by
 * the Add-Listing addendum "Preview" so the RP can review the rendered addendum
 * without a full-screen overlay covering the unit details they're still filling.
 *
 * @react-pdf/renderer is browser-only and heavy, so it (and the contract
 * renderer) are imported lazily at call time — they never enter the page bundle.
 * The placeholder contract mirrors AddendumTermsPreview: AddendumDoc only reads
 * property.emirate (jurisdiction/header) and createdAt; emirate null → Dubai.
 */
import type { AddendumTerms } from '@/lib/addendumTerms';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';

const PREVIEW_DATA: Omit<EjariContractData, 'createdAt'> = {
  ref: 'PREVIEW', startDate: '', endDate: '',
  annualRent: 0, contractValue: null, securityDepositAmount: null, modeOfPayment: null,
  landlord: { name: null, email: null, phone: null },
  tenant: { name: null, email: null, phone: null },
  property: { buildingName: null, fullAddress: null, community: null, emirate: null, plotNumber: null, makaniNumber: null },
  unit: { number: null, name: null, type: null, sizeSqm: null },
};

export async function openAddendumPdfInNewTab(terms: AddendumTerms, title?: string): Promise<void> {
  // Open the tab synchronously inside the click gesture so popup blockers allow
  // it; we point it at the blob URL once the PDF finishes rendering.
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const [{ pdf }, { AddendumDoc }] = await Promise.all([
      import('@react-pdf/renderer'),
      import('@/components/contract/EjariContractPdf'),
    ]);
    const data: EjariContractData = { ...PREVIEW_DATA, createdAt: new Date().toISOString() };
    const addendum: EjariAddendum = {
      id: 0,
      name: (title && title.trim()) || 'Agreement Addendum',
      tenantSig: null, tenantSignedAt: null, landlordSig: null, landlordSignedAt: null,
      terms,
    };
    const blob = await pdf(<AddendumDoc data={data} addendums={[addendum]} />).toBlob();
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    // Give the tab time to load before reclaiming the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    alert(`Could not generate the addendum preview: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
}
