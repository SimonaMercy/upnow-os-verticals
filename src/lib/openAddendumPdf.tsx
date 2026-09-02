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

async function renderAddendumBlob(terms: AddendumTerms, title?: string): Promise<Blob> {
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
  return pdf(<AddendumDoc data={data} addendums={[addendum]} />).toBlob();
}

export async function openAddendumPdfInNewTab(terms: AddendumTerms, title?: string): Promise<void> {
  // Open the tab synchronously inside the click gesture so popup blockers allow
  // it; we point it at the blob URL once the PDF finishes rendering.
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const blob = await renderAddendumBlob(terms, title);
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

/** `My addendum: v2!` → `Addendum-My-addendum-v2.pdf` */
export function addendumFileName(title?: string): string {
  const slug = (title || 'Agreement Addendum').trim().replace(/[^\w-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return `Addendum-${slug || 'Agreement-Addendum'}.pdf`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Render an in-app addendum to a PDF and SAVE it (templates page "Download"). */
export async function downloadAddendumPdf(terms: AddendumTerms, title?: string): Promise<void> {
  try {
    const blob = await renderAddendumBlob(terms, title);
    saveBlob(blob, addendumFileName(title));
  } catch (e) {
    alert(`Could not generate the addendum PDF: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
}

/** Download a file-based addendum template by fetching its stored file. A
 *  cross-origin signed URL ignores the anchor `download` attribute, so we pull
 *  the bytes and save the blob under our own name; if the bucket blocks the
 *  fetch (CORS), fall back to opening the file in a new tab. */
export async function downloadAddendumFile(fileUrl: string, title?: string, mimeType?: string | null): Promise<void> {
  const ext = mimeType?.includes('word') ? '.docx' : '.pdf';
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    saveBlob(blob, addendumFileName(title).replace(/\.pdf$/, ext));
  } catch {
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  }
}
