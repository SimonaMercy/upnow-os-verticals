'use client';

/**
 * Renders ONE customer document onto a <canvas> so the underlying file URL never
 * sits on an <img>/<iframe> in the DOM and the browser offers no "Save image /
 * frame as" of the original:
 *
 *  - Images load through a plain Image element (no CORS needed) and are drawn to
 *    a canvas. That taints the canvas, so the browser refuses to "Save image
 *    as", and we bake a tiled watermark over it.
 *  - PDFs are fetched as bytes and rasterised page-by-page with pdf.js, again
 *    with the watermark baked in. Fetching the presigned URL is cross-origin, so
 *    it needs a CORS GET rule on the bucket; until that exists in an environment
 *    the fetch throws and we fall back to the chrome-less (toolbar-0) iframe so
 *    viewing never breaks — that fallback can't be watermarked.
 *
 * No web API can stop an OS screenshot; the watermark (viewer identity + the
 * moment it was opened) is the deterrent that makes any leak traceable.
 */
import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

// Bundled worker (Next/webpack emits it as an asset from the installed package,
// so its version always matches the API — no CDN, no version skew).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/** Cap the backing-store resolution so big scans don't blow up memory. */
const MAX_W = 1500;
/** Guard against pathological page counts. */
const MAX_PAGES = 20;

type Status = 'loading' | 'ready' | 'fallback' | 'error';

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  if (!text) return;
  ctx.save();
  const fontSize = Math.max(14, Math.round(Math.min(w, h) * 0.022));
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, fontSize / 7);
  ctx.lineJoin = 'round';
  const textWidth = ctx.measureText(text).width;
  const diag = Math.sqrt(w * w + h * h);
  const stepX = textWidth + fontSize * 8;
  const stepY = fontSize * 9;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  for (let y = -diag; y < diag; y += stepY) {
    for (let x = -diag; x < diag; x += stepX) {
      // Faint dark outline + light fill: traceable but readable through it, and
      // legible on light OR dark docs. Kept low-alpha + widely spaced so it never
      // obscures what's being read.
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(text, x, y);
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}

export function SecureDocCanvas({
  fileUrl,
  isImage,
  caption,
  watermark,
}: {
  fileUrl: string;
  isImage: boolean;
  caption: string | null;
  watermark: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    setStatus('loading');

    const addCanvas = (w: number, h: number, gap = false) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.className = 'w-full block select-none';
      c.style.maxWidth = '100%';
      c.style.height = 'auto';
      if (gap) c.style.marginTop = '8px';
      host.appendChild(c);
      return c.getContext('2d')!;
    };

    async function renderImage() {
      const img = new Image();
      img.decoding = 'async';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
        img.src = fileUrl;
      });
      if (cancelled) return;
      const natW = img.naturalWidth || MAX_W;
      const natH = img.naturalHeight || MAX_W;
      const scale = Math.min(1, MAX_W / natW);
      const w = Math.round(natW * scale);
      const h = Math.round(natH * scale);
      const ctx = addCanvas(w, h);
      ctx.drawImage(img, 0, 0, w, h);
      drawWatermark(ctx, w, h, watermark);
      if (!cancelled) setStatus('ready');
    }

    async function renderPdf() {
      const res = await fetch(fileUrl, { credentials: 'omit' });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buf = await res.arrayBuffer();
      if (cancelled) return;
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      const pages = Math.min(pdf.numPages, MAX_PAGES);
      for (let n = 1; n <= pages; n++) {
        if (cancelled) return;
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, MAX_W / base.width);
        const vp = page.getViewport({ scale });
        const ctx = addCanvas(Math.ceil(vp.width), Math.ceil(vp.height), n > 1);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (cancelled) return;
        drawWatermark(ctx, Math.ceil(vp.width), Math.ceil(vp.height), watermark);
      }
      if (!cancelled) setStatus('ready');
    }

    (isImage ? renderImage() : renderPdf()).catch((err) => {
      if (cancelled) return;
      console.warn('[docviewer] canvas render failed; falling back', err);
      // Images can't fall back to an iframe meaningfully; PDFs can.
      setStatus(isImage ? 'error' : 'fallback');
    });

    return () => {
      cancelled = true;
    };
  }, [fileUrl, isImage, watermark]);

  return (
    <div>
      <div ref={hostRef} />
      {status === 'loading' && (
        <div className="p-10 text-center text-xs text-[#6b6860]">Loading…</div>
      )}
      {status === 'error' && (
        <div className="p-10 text-center text-xs text-[#a6a29a]">Preview unavailable.</div>
      )}
      {status === 'fallback' && (
        <iframe
          src={`${fileUrl}#toolbar=0&navpanes=0&statusbar=0&view=FitH`}
          title={caption ?? 'Document'}
          className="w-full h-[72vh] border-0 block bg-white"
        />
      )}
    </div>
  );
}
