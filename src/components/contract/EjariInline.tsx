'use client';

/**
 * Inline (embeddable) version of the Ejari tenancy contract — renders the SAME
 * vector PDF document used by the print pages, sized for a page section instead
 * of full-screen. @react-pdf needs the browser, so load this via next/dynamic
 * with ssr:false.
 */
import { PDFViewer } from '@react-pdf/renderer';
import { EjariContractDoc, type EjariContractData, type EjariAddendum } from './EjariContractPdf';

export default function EjariInline({ data, addendums = [], height = 640 }: {
  data: EjariContractData; addendums?: EjariAddendum[]; height?: number;
}) {
  return (
    <PDFViewer width="100%" height={height} showToolbar style={{ border: '1px solid #e8e6e0', borderRadius: 12 }}>
      <EjariContractDoc data={data} addendums={addendums} />
    </PDFViewer>
  );
}
