'use client';

/**
 * Inline (embeddable) Ejari tenancy contract, sized for a page section.
 *  - Dubai  → the OFFICIAL DLD PDF filled with the contract data (pdf-lib),
 *             shown in an <iframe> (native PDF controls).
 *  - others → the @react-pdf vector document (emirate-aware fallback).
 * @react-pdf needs the browser, so load this via next/dynamic with ssr:false.
 */
import { PDFViewer } from '@react-pdf/renderer';
import { EjariContractDoc, type EjariContractData, type EjariAddendum } from './EjariContractPdf';
import { isDubaiContract } from '@/lib/ejariFill';
import { useFilledEjari } from './useFilledEjari';

export default function EjariInline({ data, addendums = [], height = 640 }: {
  data: EjariContractData; addendums?: EjariAddendum[]; height?: number;
}) {
  const dubai = isDubaiContract(data);
  // Hook must run unconditionally; it no-ops cheaply when not Dubai (url stays null and is unused).
  const { url, error } = useFilledEjari(data, dubai ? addendums : []);
  const frame = { border: '1px solid #e8e6e0', borderRadius: 12 } as const;

  if (dubai) {
    if (error) return <div style={{ ...frame, height, display: 'grid', placeItems: 'center', color: '#c00', fontSize: 13 }}>Failed to render contract: {error}</div>;
    if (!url) return <div style={{ ...frame, height, display: 'grid', placeItems: 'center', color: '#888', fontSize: 13 }}>Preparing contract…</div>;
    return <iframe src={url} title="Tenancy Contract" width="100%" height={height} style={frame} />;
  }

  return (
    <PDFViewer width="100%" height={height} showToolbar style={frame}>
      <EjariContractDoc data={data} addendums={addendums} />
    </PDFViewer>
  );
}
