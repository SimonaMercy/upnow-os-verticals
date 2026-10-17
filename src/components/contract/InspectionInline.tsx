'use client';

/**
 * Inline (embeddable) move-in / move-out inspection REPORT — the read-only twin
 * of the editable <InspectionReportView> workspace.
 *
 * Same treatment as the tenancy contract (<EjariInline>): the @react-pdf document
 * is generated to raw bytes and rasterised onto <canvas> via pdf.js, so the report
 * reads as ONE fixed A4 document that simply scales to the viewport — instead of a
 * responsive HTML layout that reflows its cards to a single column and squeezes the
 * component table on a phone. An <iframe src="blob:…pdf"> is never used: mobile
 * WebKit has no inline PDF viewer and renders it blank.
 *
 * @react-pdf needs the browser, so load this via next/dynamic with ssr:false.
 */
import { useMemo } from 'react';
import InspectionReportV2Pdf, { type InspectionV2PdfData } from './InspectionReportV2Pdf';
import { computeInspectionTotals, type InspectionDoc } from '@/lib/inspectionCatalog';
import type { ReportMeta } from './InspectionReportView';
import { useReactPdfDoc } from './useReactPdfDoc';
import EjariCanvas from './EjariCanvas';

export interface InspectionInlineProps {
  doc: InspectionDoc;
  meta: ReportMeta;
  phase: 'move_in' | 'move_out';
  /** Contract reference printed under the title, e.g. `CID-394`. */
  contractRef: string;
  inspectionDate?: string | null;
  moveInDate?: string | null;
  moveOutDate?: string | null;
  /** Move-out restoration costs — RP/manager/inspector only, never the customer. */
  showMoney?: boolean;
  /** Draft/Signed badge — an internal progress marker for the RP/manager side. */
  /** Cap for the loading placeholder; the document itself grows to full height. */
  height?: number;
}

/** Content fingerprint — regenerating the PDF is keyed on this, so re-renders with
 *  an unchanged report never rebuild the bytes. */
function inspectionDocKey(p: InspectionInlineProps): string {
  const d = p.doc;
  const rows = (d.categories ?? [])
    .map((c) => `${c.sectionId}:${(c.items ?? []).map((i) => `${i.id}|${i.inCondition ?? ''}|${i.outCondition ?? ''}|${i.quantity ?? ''}|${i.remarks ?? ''}|${i.totalCostAed ?? ''}`).join(',')}`)
    .join(';');
  return [
    p.contractRef, p.phase, p.showMoney ? 'money' : '-',
    p.inspectionDate ?? '', p.moveInDate ?? '', p.moveOutDate ?? '',
    d.generalNotes ?? '', d.inspectorName ?? '', d.inspectorCompany ?? '', d.inspectorRole ?? '',
    d.tenantSignedAt ?? '', d.rpCounterSignedAt ?? '',
    d.tenantSig ? 'ts' : '-', d.rpCounterSig ? 'rs' : '-',
    p.meta.property, p.meta.unitNo, p.meta.propertyType, p.meta.floor,
    p.meta.tenantName, p.meta.tenantPhone, p.meta.tenantEmail,
    rows,
  ].join('~');
}

export default function InspectionInline(props: InspectionInlineProps) {
  const { doc, meta, phase, contractRef, showMoney = false, height = 640 } = props;

  const data: InspectionV2PdfData = useMemo(() => ({
    doc, meta, phase, ref: contractRef, showMoney,
    totals: computeInspectionTotals(doc, phase),
    inspectionDate: props.inspectionDate ?? null,
    moveInDate: props.moveInDate ?? null,
    moveOutDate: props.moveOutDate ?? null,
  }), [doc, meta, phase, contractRef, showMoney, props.inspectionDate, props.moveInDate, props.moveOutDate]);

  const { bytes, error } = useReactPdfDoc(
    () => <InspectionReportV2Pdf data={data} />,
    inspectionDocKey(props),
  );

  if (error) {
    return (
      <div style={{ border: '1px solid #e4e9e5', borderRadius: 12, height, display: 'grid', placeItems: 'center', color: '#c00', fontSize: 13 }}>
        Failed to render the inspection report: {error}
      </div>
    );
  }
  // EjariCanvas shows its own "Preparing…" placeholder while bytes are null.
  return <EjariCanvas bytes={bytes} height={height} noScroll />;
}
