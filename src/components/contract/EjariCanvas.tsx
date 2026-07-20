'use client';

/**
 * Renders raw PDF bytes (from `fillEjariPdf` or @react-pdf via `useReactPdfDoc`)
 * onto a stack of <canvas> elements with pdf.js.
 *
 * Why not an <iframe> like before: mobile browsers (iOS Safari, all WebKit
 * browsers on iOS, Android Chrome) have no built-in inline PDF viewer, so an
 * <iframe src="blob:…pdf"> renders BLANK on phones — which is exactly why the
 * portal contract preview wasn't showing. Canvas rasterisation is plain 2D
 * drawing and works identically on every browser. No cross-origin fetch here
 * either (we already hold the bytes), so there's no CORS dependency.
 *
 * Scale is fit-to-width and retina-sharp, but clamped under iOS's canvas limits
 * (~4096 px per side / ~16.7M px total) — exceed them and the page silently
 * comes back blank on a phone.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import * as pdfjs from 'pdfjs-dist';
import styles from './EjariCanvas.module.css';

// Bundled worker (Next/webpack emits it from the installed package, so its
// version always matches the API — no CDN, no version skew). Same pattern as
// the customer-document viewer (SecureDocCanvas).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const MAX_W = 1500;          // fit-to-width backing-store cap (legibility vs memory)
const MAX_SIDE = 4096;       // iOS per-side canvas limit
const MAX_AREA = 16_000_000; // iOS total canvas-area limit (~16.7M px)

type Status = 'loading' | 'ready' | 'error';

export default function EjariCanvas({ bytes, height = 640, fill = false, fluid = false, noScroll = false }: {
  bytes: Uint8Array | null;
  height?: number;
  /** Full-height scrollable layout for full-screen viewers (pages centred on a
   *  transparent backdrop with a drop shadow). Default = fixed-height framed card
   *  for inline embedding. */
  fill?: boolean;
  /** Inline embed that flows to its full height on mobile (≤768px) so the host
   *  page scrolls as one — no internal scroll box. Desktop keeps the capped box.
   *  Ignored when `fill` is set. */
  fluid?: boolean;
  /** Inline embed that grows to the document's FULL height with no internal
   *  scrollbar on EVERY viewport (the host page scrolls as one). Ignored when
   *  `fill` is set; takes precedence over `fluid`. */
  noScroll?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();      // clear any prior render (incl. when bytes reset to null)
    if (!bytes) return;          // nothing to draw until the filled PDF arrives

    let cancelled = false;

    (async () => {
      // setStatus lives inside the async callback (not the effect body) so it
      // doesn't trigger cascading renders — react-hooks/set-state-in-effect.
      setStatus('loading');
      // pdf.js may transfer (detach) the buffer to its worker — hand it a copy
      // so the hook's `bytes` stay valid (the download link reuses them).
      const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Size each page's backing store to the ACTUAL display width (× dpr),
      // capped — NOT a fixed oversample. The old `min(2, …) * dpr` built a
      // ~2400px-wide (~32MB) canvas per A4 page no matter the screen; a few of
      // those stacked exhaust iOS Safari's per-tab memory and the page is killed
      // ("a problem repeatedly occurred"). Matching display width stays crisp
      // (≈2× density) at a fraction of the memory.
      const cssW = host.clientWidth || Math.min(window.innerWidth || 360, 820);
      const targetW = Math.min(Math.round(cssW * dpr), MAX_W);
      for (let n = 1; n <= pdf.numPages; n++) {
        if (cancelled) return;
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        let scale = targetW / base.width;
        // Clamp under iOS canvas limits so the page never renders blank on a phone.
        scale = Math.min(
          scale,
          MAX_SIDE / base.width,
          MAX_SIDE / base.height,
          Math.sqrt(MAX_AREA / (base.width * base.height)),
        );
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        // Backing store is hi-dpi; CSS scales it down to container width → crisp.
        c.className = 'block w-full h-auto';
        c.style.maxWidth = '100%';
        if (fill) {
          // Full-screen: each page is a white card with a drop shadow on the
          // viewer's dark backdrop.
          c.style.background = '#fff';
          c.style.borderRadius = '4px';
          c.style.boxShadow = '0 1px 12px rgba(0,0,0,0.4)';
          if (n > 1) c.style.marginTop = '16px';
        } else if (n > 1) {
          c.style.marginTop = '8px';
        }
        host.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      }
      if (!cancelled) setStatus('ready');
    })().catch((err) => {
      if (cancelled) return;
      console.warn('[ejari] canvas render failed', err);
      setStatus('error');
    });

    return () => { cancelled = true; };
  }, [bytes, fill]);

  if (fill) {
    return (
      <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div ref={hostRef} style={{ maxWidth: 820, width: '100%', margin: '0 auto', padding: '20px 16px' }} />
        {status === 'loading' && (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#e3f5ee', fontSize: 13 }}>Preparing preview…</div>
        )}
        {status === 'error' && (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 16, color: '#fff', fontSize: 13 }}>Preview unavailable — use the download button above.</div>
        )}
      </div>
    );
  }

  const frame = { border: '1px solid #e8e6e0', borderRadius: 12 } as const;
  // No-scroll grows to content, so a full-height placeholder box would leave a
  // large gap before the pages arrive — use a modest loading height instead.
  const loadingH = noScroll ? 360 : height;
  return (
    <div
      className={fluid && !noScroll ? styles.fluidFrame : undefined}
      style={noScroll
        ? { ...frame, background: '#fff' }
        : fluid
          ? ({ '--ejari-max': `${height}px` } as unknown as CSSProperties)
          : { ...frame, maxHeight: height, overflow: 'auto', background: '#fff' }}
    >
      <div ref={hostRef} />
      {status === 'loading' && (
        <div style={{ height: loadingH, display: 'grid', placeItems: 'center', color: '#888', fontSize: 13 }}>Preparing contract…</div>
      )}
      {status === 'error' && (
        <div style={{ height: loadingH, display: 'grid', placeItems: 'center', color: '#c00', fontSize: 13 }}>Preview unavailable.</div>
      )}
    </div>
  );
}
