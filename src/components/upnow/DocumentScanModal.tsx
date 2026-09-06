'use client';

/**
 * DocumentScanModal — CamScanner-style capture clean-up before upload.
 *
 * Opens on every image the user picks for a document slot. Step 1 shows the
 * photo with the auto-detected document outline and draggable corner handles;
 * step 2 shows the flattened result with an Enhanced / Original-colours toggle.
 * Confirming hands the caller a processed JPEG that continues down the normal
 * upload path; "Use photo as-is" bypasses processing entirely, so a failed
 * detection can never block an upload.
 *
 * Use via the `useDocumentScanner` hook:
 *   const { scan, scannerModal } = useDocumentScanner();
 *   const file = await scan(picked);   // resolves processed File, original, or null (cancelled)
 *   …render {scannerModal} anywhere in the tree…
 * Non-image files (PDFs) resolve immediately unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, ScanLine, Sparkles, ArrowLeft, UploadCloud, ImageIcon } from 'lucide-react';
import {
  type ScanQuad,
  canvasToJpegFile,
  defaultQuad,
  detectDocumentQuad,
  enhanceScan,
  fileToCanvas,
  warpDocument,
} from '@/lib/docScan';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function DocumentScanModal({ file, onConfirm, onUseOriginal, onCancel }: {
  file: File;
  /** Processed scan approved — upload this file instead of the original. */
  onConfirm: (scanned: File) => void;
  /** Skip processing — upload the untouched original. */
  onUseOriginal: () => void;
  /** Abort — nothing is uploaded. */
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<'adjust' | 'preview'>('adjust');
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [quad, setQuad] = useState<ScanQuad | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [autoFound, setAutoFound] = useState<boolean | null>(null);
  const [processed, setProcessed] = useState<{ plain: HTMLCanvasElement; enhanced: HTMLCanvasElement } | null>(null);
  const [useEnhanced, setUseEnhanced] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load + detect ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      let canvas: HTMLCanvasElement;
      try {
        canvas = await fileToCanvas(file);
      } catch {
        if (alive) { setError('Could not read this photo.'); setDetecting(false); }
        return;
      }
      if (!alive) return;
      setSource(canvas);
      setQuad(defaultQuad(canvas.width, canvas.height));
      try {
        const found = await detectDocumentQuad(canvas);
        if (!alive) return;
        if (found) setQuad(found);
        setAutoFound(!!found);
      } catch {
        // Engine unavailable (offline, blocked) — manual corners still work,
        // and "Use photo as-is" always does.
        if (alive) setAutoFound(false);
      } finally {
        if (alive) setDetecting(false);
      }
    })();
    return () => { alive = false; };
  }, [file]);

  // ── Fit the image into the viewport ────────────────────────────────────────
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0, scale: 1 });
  useEffect(() => {
    if (!source) return;
    const compute = () => {
      const box = boxRef.current;
      if (!box) return;
      const maxW = Math.max(120, box.clientWidth - 24);
      const maxH = Math.max(240, window.innerHeight * 0.55);
      const scale = Math.min(maxW / source.width, maxH / source.height);
      setView({ w: Math.max(1, Math.round(source.width * scale)), h: Math.max(1, Math.round(source.height * scale)), scale });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [source, phase]);

  const viewRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = viewRef.current;
    const box = boxRef.current;
    if (!c || !box || !view.w) return;
    const shown = phase === 'preview' && processed
      ? processed[useEnhanced ? 'enhanced' : 'plain']
      : source;
    if (!shown) return;
    // In the adjust phase the canvas must match the overlay geometry exactly;
    // the flattened preview has its own aspect ratio, so it refits the box.
    let w = view.w;
    let h = view.h;
    if (phase === 'preview') {
      const maxW = Math.max(120, box.clientWidth - 24);
      const maxH = Math.max(240, window.innerHeight * 0.55);
      const s = Math.min(maxW / shown.width, maxH / shown.height);
      w = Math.max(1, Math.round(shown.width * s));
      h = Math.max(1, Math.round(shown.height * s));
    }
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(shown, 0, 0, w, h);
  }, [source, processed, useEnhanced, view, phase]);

  // ── Corner + edge dragging ─────────────────────────────────────────────────
  // A corner drags with the offset it was grabbed at (no snap-to-fingertip
  // jump); an edge handle translates BOTH its endpoints, clamped so neither
  // leaves the frame — the CamScanner "move the whole line" gesture.
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | { kind: 'corner'; i: number; offX: number; offY: number }
    | { kind: 'edge'; i: number; lastX: number; lastY: number }
    | null
  >(null);

  const pointerImagePos = (e: React.PointerEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (e.clientX - rect.left) / view.scale, y: (e.clientY - rect.top) / view.scale };
  };

  // Magnifier shown while a corner is being dragged, so the exact pixel under
  // the (finger-obscured) corner stays visible. Image coords of the corner.
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = loupeRef.current;
    if (!c || !loupe || !source) return;
    const ctx = c.getContext('2d')!;
    // 3× the on-screen zoom, capped at 2× native pixels.
    const mag = Math.min(Math.max(3 * view.scale, 0.5), 2);
    const region = c.width / mag;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, loupe.x - region / 2, loupe.y - region / 2, region, region, 0, 0, c.width, c.height);
    ctx.strokeStyle = '#2e9f82';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.width / 2, c.height / 2 - 14);
    ctx.lineTo(c.width / 2, c.height / 2 + 14);
    ctx.moveTo(c.width / 2 - 14, c.height / 2);
    ctx.lineTo(c.width / 2 + 14, c.height / 2);
    ctx.stroke();
  }, [loupe, source, view.scale]);

  const startCorner = (i: number) => (e: React.PointerEvent) => {
    const p = pointerImagePos(e);
    if (!p || !quad) return;
    drag.current = { kind: 'corner', i, offX: quad[i].x - p.x, offY: quad[i].y - p.y };
    setLoupe({ x: quad[i].x, y: quad[i].y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const startEdge = (i: number) => (e: React.PointerEvent) => {
    const p = pointerImagePos(e);
    if (!p) return;
    drag.current = { kind: 'edge', i, lastX: p.x, lastY: p.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onDragMove = (e: React.PointerEvent) => {
    const t = drag.current;
    if (!t || !source) return;
    const p = pointerImagePos(e);
    if (!p) return;
    if (t.kind === 'corner') {
      const x = clamp(p.x + t.offX, 0, source.width);
      const y = clamp(p.y + t.offY, 0, source.height);
      setLoupe({ x, y });
      setQuad((prev) => {
        if (!prev) return prev;
        const next = [...prev] as ScanQuad;
        next[t.i] = { x, y };
        return next;
      });
    } else {
      const rawDx = p.x - t.lastX;
      const rawDy = p.y - t.lastY;
      t.lastX = p.x;
      t.lastY = p.y;
      setQuad((prev) => {
        if (!prev) return prev;
        const a = prev[t.i];
        const b = prev[(t.i + 1) % 4];
        const dx = clamp(rawDx, -Math.min(a.x, b.x), source.width - Math.max(a.x, b.x));
        const dy = clamp(rawDy, -Math.min(a.y, b.y), source.height - Math.max(a.y, b.y));
        const next = [...prev] as ScanQuad;
        next[t.i] = { x: a.x + dx, y: a.y + dy };
        next[(t.i + 1) % 4] = { x: b.x + dx, y: b.y + dy };
        return next;
      });
    }
  };
  const endDrag = () => { drag.current = null; setLoupe(null); };

  // ── Actions ────────────────────────────────────────────────────────────────
  const goPreview = async () => {
    if (!source || !quad || working) return;
    setWorking(true);
    setError(null);
    try {
      const plain = await warpDocument(source, quad);
      setProcessed({ plain, enhanced: enhanceScan(plain) });
      setPhase('preview');
    } catch {
      setError('Could not process the photo — you can still upload it as-is.');
    } finally {
      setWorking(false);
    }
  };

  const confirm = async () => {
    if (!processed || working) return;
    setWorking(true);
    try {
      onConfirm(await canvasToJpegFile(processed[useEnhanced ? 'enhanced' : 'plain'], file.name));
    } catch {
      setError('Could not export the scan — you can still upload the photo as-is.');
      setWorking(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const statusChip = detecting
    ? { icon: <Loader2 size={12} className="animate-spin" />, text: source ? 'Detecting document…' : 'Preparing scanner…' }
    : autoFound === false && phase === 'adjust'
      ? { icon: <ScanLine size={12} />, text: 'Edges not found — drag the corners to the document' }
      : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#e8e6e0]">
          <h3 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2 min-w-0">
            <ScanLine size={16} className="text-[#2e9f82] shrink-0" />
            <span className="truncate">{phase === 'adjust' ? 'Scan document' : 'Review scan'}</span>
          </h3>
          <button type="button" onClick={onCancel} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Canvas area */}
        <div ref={boxRef} className="flex-1 min-h-[240px] overflow-hidden bg-[#14130f] flex items-center justify-center relative px-3 py-3">
          {!source && !error && (
            <div className="flex items-center gap-2 text-sm text-white/80"><Loader2 size={16} className="animate-spin" /> Opening photo…</div>
          )}
          {source && (
            <div
              ref={overlayRef}
              className="relative touch-none select-none"
              style={phase === 'adjust' ? { width: view.w, height: view.h } : undefined}
              onPointerMove={phase === 'adjust' ? onDragMove : undefined}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <canvas ref={viewRef} className="block rounded-lg" style={{ maxWidth: '100%' }} />
              {phase === 'adjust' && quad && (
                <>
                  <svg className="absolute inset-0 pointer-events-none" width={view.w} height={view.h}>
                    <polygon
                      points={quad.map((p) => `${p.x * view.scale},${p.y * view.scale}`).join(' ')}
                      fill="rgba(46,159,130,0.18)"
                      stroke="#2e9f82"
                      strokeWidth={2}
                    />
                  </svg>
                  {/* Edge handles — drag to move a whole side */}
                  {quad.map((p, i) => {
                    const q = quad[(i + 1) % 4];
                    const mx = (p.x + q.x) / 2;
                    const my = (p.y + q.y) / 2;
                    return (
                      <div
                        key={`e${i}`}
                        onPointerDown={startEdge(i)}
                        className="absolute w-8 h-8 -ml-4 -mt-4 cursor-move flex items-center justify-center"
                        style={{ left: mx * view.scale, top: my * view.scale }}
                      >
                        <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-[#2e9f82] shadow-md" />
                      </div>
                    );
                  })}
                  {/* Corner handles */}
                  {quad.map((p, i) => (
                    <div
                      key={i}
                      onPointerDown={startCorner(i)}
                      className="absolute w-9 h-9 rounded-full cursor-grab active:cursor-grabbing flex items-center justify-center"
                      style={{ left: p.x * view.scale, top: p.y * view.scale, transform: 'translate(-50%, -50%)' }}
                    >
                      <div className="w-5 h-5 rounded-full bg-[#2e9f82] border-2 border-white shadow-md" />
                    </div>
                  ))}
                  {/* Magnifier while a corner is dragged, on the side away from the finger */}
                  {loupe && source && (
                    <div
                      className="absolute top-2 pointer-events-none rounded-full overflow-hidden border-2 border-white shadow-xl"
                      style={loupe.x < source.width / 2 ? { right: 8 } : { left: 8 }}
                    >
                      <canvas ref={loupeRef} width={120} height={120} className="block" />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {statusChip && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-[11px] font-medium text-white bg-black/60 rounded-full px-3 py-1.5 whitespace-nowrap">
              {statusChip.icon} {statusChip.text}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="px-5 py-3.5 border-t border-[#e8e6e0] space-y-3">
          {error && <p className="text-xs text-[#b91c1c]">{error}</p>}

          {phase === 'adjust' ? (
            <>
              <p className="text-[11px] text-[#9b9890]">Drag the corners so the outline hugs the document edges, then continue.</p>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button type="button" onClick={onCancel} className="text-sm font-medium text-[#6b6860] hover:text-[#1a1916] px-2 py-2 cursor-pointer">
                  Cancel
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={onUseOriginal}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-full border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef] cursor-pointer">
                    <ImageIcon size={13} /> Use photo as-is
                  </button>
                  <button type="button" onClick={goPreview} disabled={!source || !quad || working}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full bg-[#2e9f82] text-white hover:bg-[#267a65] disabled:opacity-50 cursor-pointer">
                    {working ? <Loader2 size={13} className="animate-spin" /> : <ScanLine size={13} />} Continue
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 bg-[#f4f3ef] rounded-full p-1 w-fit">
                <button type="button" onClick={() => setUseEnhanced(true)}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer ${useEnhanced ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860]'}`}>
                  <Sparkles size={12} className={useEnhanced ? 'text-[#2e9f82]' : ''} /> Enhanced
                </button>
                <button type="button" onClick={() => setUseEnhanced(false)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer ${!useEnhanced ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860]'}`}>
                  Original colours
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button type="button" onClick={() => setPhase('adjust')}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6b6860] hover:text-[#1a1916] px-2 py-2 cursor-pointer">
                  <ArrowLeft size={14} /> Adjust corners
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={onUseOriginal}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-full border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef] cursor-pointer">
                    <ImageIcon size={13} /> Use photo as-is
                  </button>
                  <button type="button" onClick={confirm} disabled={working}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full bg-[#2e9f82] text-white hover:bg-[#267a65] disabled:opacity-50 cursor-pointer">
                    {working ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} Upload scan
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Promise-based bridge between a file input and the scan modal.
 * `scan(file)` resolves with the file to upload (processed scan or untouched
 * original) or null when the user cancelled — abort the upload on null.
 */
export function useDocumentScanner() {
  const [job, setJob] = useState<{ file: File; resolve: (f: File | null) => void } | null>(null);

  const scan = useCallback((file: File): Promise<File | null> => {
    if (!file.type.startsWith('image/')) return Promise.resolve(file);
    return new Promise<File | null>((resolve) => setJob({ file, resolve }));
  }, []);

  const finish = (result: File | null) => {
    setJob((current) => {
      current?.resolve(result);
      return null;
    });
  };

  const scannerModal = job ? (
    <DocumentScanModal
      file={job.file}
      onConfirm={(f) => finish(f)}
      onUseOriginal={() => finish(job.file)}
      onCancel={() => finish(null)}
    />
  ) : null;

  return { scan, scannerModal };
}
