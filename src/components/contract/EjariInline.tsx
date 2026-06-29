'use client';

/**
 * Inline (embeddable) Ejari tenancy contract, sized for a page section.
 *  - Dubai  → the OFFICIAL DLD PDF filled with the contract data (pdf-lib),
 *             rasterised to <canvas> via pdf.js (EjariCanvas). An <iframe> blob
 *             PDF renders blank on mobile browsers, so we don't use one.
 *  - others → the @react-pdf vector document (emirate-aware fallback).
 * @react-pdf needs the browser, so load this via next/dynamic with ssr:false.
 */
import { PDFViewer } from '@react-pdf/renderer';
import { EjariContractDoc, type EjariContractData, type EjariAddendum } from './EjariContractPdf';
import { isDubaiContract } from '@/lib/ejariFill';
import { useFilledEjari } from './useFilledEjari';
import EjariCanvas from './EjariCanvas';

export default function EjariInline({ data, addendums = [], height = 640 }: {
  data: EjariContractData; addendums?: EjariAddendum[]; height?: number;
}) {
  const dubai = isDubaiContract(data);
  // Hook must run unconditionally; it no-ops cheaply when not Dubai (bytes stay null and are unused).
  const { bytes, error } = useFilledEjari(data, dubai ? addendums : []);
  const frame = { border: '1px solid #e8e6e0', borderRadius: 12 } as const;

  if (dubai) {
    if (error) return <div style={{ ...frame, height, display: 'grid', placeItems: 'center', color: '#c00', fontSize: 13 }}>Failed to render contract: {error}</div>;
    // EjariCanvas shows its own "Preparing contract…" placeholder while bytes are null.
    return <EjariCanvas bytes={bytes} height={height} />;
  }

  return (
    <PDFViewer width="100%" height={height} showToolbar style={frame}>
      <EjariContractDoc data={data} addendums={addendums} />
    </PDFViewer>
  );
}
