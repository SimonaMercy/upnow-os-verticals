'use client';

/**
 * Inline (embeddable) Ejari tenancy contract, sized for a page section.
 *  - Dubai  → the OFFICIAL DLD PDF filled with the contract data (pdf-lib).
 *  - Ajman  → the Ajman Municipality form (@react-pdf, via contractDocFor).
 *  - others → the @react-pdf unified document (emirate-aware fallback).
 * BOTH are rasterised to <canvas> via pdf.js (EjariCanvas); an <iframe> blob PDF
 * renders blank on mobile browsers, so we never use one.
 * @react-pdf needs the browser, so load this via next/dynamic with ssr:false.
 */
import { contractDocFor, ejariDocKey, type EjariContractData, type EjariAddendum } from './EjariContractPdf';
import { isDubaiContract } from '@/lib/ejariFill';
import { useFilledEjari } from './useFilledEjari';
import { useReactPdfDoc } from './useReactPdfDoc';
import { InlineDownloadRow } from './InlineDownloadRow';
import EjariCanvas from './EjariCanvas';

export default function EjariInline({ data, addendums = [], height = 640, fluid = false, noScroll = false, showDownload = false }: {
  data: EjariContractData; addendums?: EjariAddendum[]; height?: number;
  /** Flow to full height on mobile so the host page scrolls as one (no internal
   *  scroll box). Desktop keeps the capped, internally-scrolling card. */
  fluid?: boolean;
  /** Grow to the contract's FULL height with no internal scrollbar on every
   *  viewport (the host page scrolls as one). Takes precedence over `fluid`. */
  noScroll?: boolean;
  /** Render a "⬇ Download PDF" row above the preview (the tenancy contract is the
   *  customer's own document — clean, no watermark). */
  showDownload?: boolean;
}) {
  const dubai = isDubaiContract(data);
  // Both hooks run unconditionally (rules of hooks); each takes an `enabled` flag so
  // only the branch actually shown does work. Dubai → official DLD template (pdf-lib);
  // others → @react-pdf vector doc. Each hook also exposes a blob object-URL for the
  // download link (the SAME bytes it rasterises — no extra generation).
  const { bytes: dubaiBytes, url: dubaiUrl, error: dubaiErr } = useFilledEjari(data, addendums, dubai);
  const { bytes: vectorBytes, url: vectorUrl, error: vectorErr } = useReactPdfDoc(
    () => contractDocFor(data, addendums),
    ejariDocKey(data, addendums),
    !dubai,
  );
  const bytes = dubai ? dubaiBytes : vectorBytes;
  const url = dubai ? dubaiUrl : vectorUrl;
  const error = dubai ? dubaiErr : vectorErr;
  const frame = { border: '1px solid #e4e9e5', borderRadius: 12 } as const;

  if (error) return <div style={{ ...frame, height, display: 'grid', placeItems: 'center', color: '#c00', fontSize: 13 }}>Failed to render contract: {error}</div>;
  // EjariCanvas shows its own "Preparing contract…" placeholder while bytes are null.
  return (
    <>
      {showDownload && <InlineDownloadRow url={url} fileName={`Tenancy-contract-${data.ref ?? 'contract'}.pdf`} />}
      <EjariCanvas bytes={bytes} height={height} fluid={fluid} noScroll={noScroll} />
    </>
  );
}
