'use client';

/**
 * SignatureBlock — the ONE signing block used by every surface in the product:
 * contract, addendum, inspection and settlement, on both the authenticated
 * dashboards and the no-login magic-link portal.
 *
 * The layout is fixed and identical everywhere, in this order:
 *   1. Identity line   — "Signing as {role}: {name}", plus an "on behalf of {B}"
 *                        line when the signer acts under Power of Attorney.
 *   2. Signature pad   — one shared canvas (pointer events, DPR-fit, PNG export).
 *      2b. Company stamp — only when the caller passes `stamp` (commercial
 *          leases, customer side): an image upload beside the pad; required
 *          when the customer is a company, optional otherwise.
 *   3. Terms checkbox  — mandatory; context sentence + the shared e-sign consent.
 *   4. Sign button     — declaratively disabled until the pad is drawn AND the
 *                        terms box is checked (no imperative alert-on-submit).
 *
 * The caller owns the transport: it passes `onSign`, which receives the drawn
 * signature image, the typed name and `consent: true`. Device/geo evidence is
 * collected here via the shared helpers so every surface reports it uniformly;
 * callers merge it into their own API payload.
 */
import { useEffect, useRef, useState } from 'react';
import { PenLine, CheckCircle2, Loader2, BadgeCheck, Stamp, X } from 'lucide-react';
import {
  ESIGN_CONSENT_TEXT,
  collectClientMeta,
  collectGeo,
  type SignClientMeta,
  type SignGeo,
} from '@/lib/signEvidence';

export interface SignaturePayload {
  signatureImage: string;
  signatoryName: string;
  consent: true;
  clientMeta: SignClientMeta;
  geo: SignGeo | null;
  /** Company stamp/seal image (data URL) — present only when the caller enabled
   *  the stamp section and the signer uploaded one. */
  stampImage?: string | null;
}

/** Crop rectangle in the image's natural pixel coordinates. */
interface StampBox { x: number; y: number; w: number; h: number }
/** A chosen file waiting for the customer to confirm its crop. */
interface StampCropSession { url: string; img: HTMLImageElement; box: StampBox }

/** Load a chosen stamp file (≤10 MB) and pre-place the crop box by detecting
 *  the content against the background (sampled from the corners). On a clean
 *  scan the box lands tightly around the seal; on a busy photo it falls back
 *  to the whole frame — either way the customer adjusts and confirms it. */
async function loadStampForCrop(file: File): Promise<StampCropSession> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('That image is too large — please use a photo or scan under 10 MB');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read that image'));
      i.src = url;
    });
    const work = document.createElement('canvas');
    const ws = Math.min(1200 / img.width, 1200 / img.height, 1); // cap the scan size
    work.width = Math.max(1, Math.round(img.width * ws));
    work.height = Math.max(1, Math.round(img.height * ws));
    const wctx = work.getContext('2d')!;
    wctx.drawImage(img, 0, 0, work.width, work.height);
    const { data: wd } = wctx.getImageData(0, 0, work.width, work.height);
    const at = (x: number, y: number) => (y * work.width + x) * 4;
    const corners = [at(0, 0), at(work.width - 1, 0), at(0, work.height - 1), at(work.width - 1, work.height - 1)];
    const bg = [0, 1, 2, 3].map(ch => corners.reduce((a, o) => a + wd[o + ch], 0) / 4);
    const isBgDiff = (o: number) => {
      if (wd[o + 3] < 16) return false; // fully transparent = background
      const d = Math.max(Math.abs(wd[o] - bg[0]), Math.abs(wd[o + 1] - bg[1]), Math.abs(wd[o + 2] - bg[2]), Math.abs(wd[o + 3] - bg[3]));
      return d > 48;
    };
    // Two detectors in one pass:
    //  • CHROMA (primary) — stamp ink is COLORED (blue/red) while paper, walls
    //    and shadows are grey, so saturated pixels locate the seal itself even
    //    on a messy photo. Percentile bounds shrug off stray colored specks.
    //  • BACKGROUND-DIFF (fallback) — catches black-ink stamps on clean scans,
    //    where chroma finds nothing but contrast against the page works.
    const chromaCols = new Float64Array(work.width);
    const chromaRows = new Float64Array(work.height);
    let chromaTotal = 0;
    let minX = work.width, minY = work.height, maxX = -1, maxY = -1;
    for (let y = 0; y < work.height; y++) {
      for (let x = 0; x < work.width; x++) {
        const o = at(x, y);
        if (wd[o + 3] >= 16) {
          const chroma = Math.max(wd[o], wd[o + 1], wd[o + 2]) - Math.min(wd[o], wd[o + 1], wd[o + 2]);
          if (chroma > 40) { chromaCols[x]++; chromaRows[y]++; chromaTotal++; }
        }
        if (isBgDiff(o)) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    // Walk in from each edge until 1% of the chroma mass is passed — bounds
    // that ignore isolated colored noise.
    const pctBounds = (arr: Float64Array, total: number): [number, number] => {
      let lo = 0, hi = arr.length - 1, acc = 0;
      for (let i = 0; i < arr.length; i++) { acc += arr[i]; if (acc > total * 0.01) { lo = i; break; } }
      acc = 0;
      for (let i = arr.length - 1; i >= 0; i--) { acc += arr[i]; if (acc > total * 0.01) { hi = i; break; } }
      return [lo, hi];
    };
    const frameArea = work.width * work.height;
    let bx = 0, by = 0, bw = 0, bh = 0, usable = false;
    if (chromaTotal > frameArea * 0.0005 && chromaTotal < frameArea * 0.5) {
      const [cx0, cx1] = pctBounds(chromaCols, chromaTotal);
      const [cy0, cy1] = pctBounds(chromaRows, chromaTotal);
      bx = cx0; by = cy0; bw = cx1 - cx0 + 1; bh = cy1 - cy0 + 1;
      usable = bw > 8 && bh > 8 && bw * bh < frameArea * 0.9;
    }
    if (!usable && maxX >= 0) {
      bx = minX; by = minY; bw = maxX - minX + 1; bh = maxY - minY + 1;
      usable = bw * bh > frameArea * 0.005 && bw * bh < frameArea * 0.9;
    }
    const pad = usable ? Math.round(Math.max(bw, bh) * 0.1) : 0;
    const box: StampBox = usable
      ? {
          x: Math.max(0, bx - pad) / ws,
          y: Math.max(0, by - pad) / ws,
          w: Math.min(work.width - Math.max(0, bx - pad), bw + pad * 2) / ws,
          h: Math.min(work.height - Math.max(0, by - pad), bh + pad * 2) / ws,
        }
      : { x: 0, y: 0, w: img.width, h: img.height };
    return { url, img, box };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Compress the confirmed crop to a compact data URL — bounded so it travels
 *  inside the JSON sign request like the signature itself, no matter how big
 *  the source file was. A stamp graphic with transparency stays PNG (the seal
 *  floats over the contract); an opaque photo/scan is JPEG-compressed,
 *  stepping the quality down until it fits the budget. Proportional crop +
 *  proportional scale: nothing is ever squashed. */
function compressStampCrop(img: HTMLImageElement, box: StampBox): string {
  const sx = Math.max(0, Math.min(img.width - 1, Math.round(box.x)));
  const sy = Math.max(0, Math.min(img.height - 1, Math.round(box.y)));
  const sw = Math.max(1, Math.min(img.width - sx, Math.round(box.w)));
  const sh = Math.max(1, Math.min(img.height - sy, Math.round(box.h)));
  const MAX = 480;
  const s = Math.min(MAX / sw, MAX / sh, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * s));
  c.height = Math.max(1, Math.round(sh * s));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);

  // Transparency check (sampled): a real stamp graphic keeps its alpha and
  // stays PNG — small by nature. Anything opaque is a photo/scan: JPEG.
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let transparent = false;
  for (let i = 3; i < px.length; i += 64) {
    if (px[i] < 250) { transparent = true; break; }
  }
  const BUDGET = 400_000; // data-URL chars (~300 KB binary) — well under the API's cap
  if (transparent) {
    const png = c.toDataURL('image/png');
    if (png.length <= BUDGET) return png;
  }
  // Flatten onto white (JPEG has no alpha) and step quality down to fit.
  const flat = document.createElement('canvas');
  flat.width = c.width; flat.height = c.height;
  const fctx = flat.getContext('2d')!;
  fctx.fillStyle = '#fff';
  fctx.fillRect(0, 0, flat.width, flat.height);
  fctx.drawImage(c, 0, 0);
  let out = '';
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    out = flat.toDataURL('image/jpeg', q);
    if (out.length <= BUDGET) return out;
  }
  return out;
}

export function SignatureBlock({
  signerRole = 'Landlord',
  signerName,
  onBehalfOf,
  defaultName = '',
  termsText,
  submitLabel,
  alreadySigned,
  disabledReason,
  stamp,
  onSign,
}: {
  /** Party label, e.g. "Landlord" | "Customer" | "Inspector". */
  signerRole?: string;
  /** Who is actually signing (person or company), shown on the identity line. */
  signerName?: string | null;
  /** When set, the signer acts under POA — renders "on behalf of {onBehalfOf}". */
  onBehalfOf?: string | null;
  /** Pre-fills the typed-name field. */
  defaultName?: string;
  /** Context sentence shown before ESIGN_CONSENT_TEXT in the terms checkbox. */
  termsText: string;
  /** Submit-button label, e.g. "Sign contract" | "Counter-sign move-out". */
  submitLabel?: string;
  /** When true, renders the completed state and offers no action. */
  alreadySigned: boolean;
  /** Optional external gate; when set the button is disabled and this is shown. */
  disabledReason?: string | null;
  /** Company-stamp section (commercial leases, customer side). When set, an
   *  image upload renders under the pad; `required: true` (company customers)
   *  gates the sign button on it, otherwise it is offered as optional. */
  stamp?: { required: boolean } | null;
  /** Persist the signature. Throw to surface an error under the button. */
  onSign: (payload: SignaturePayload) => Promise<void>;
}) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [agreed, setAgreed] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [stampImage, setStampImage] = useState<string | null>(null);
  const [stampErr, setStampErr] = useState<string | null>(null);
  // A chosen file awaiting crop confirmation. Mobile-first pattern: a FIXED
  // frame, and the customer moves/zooms the photo under it (one-finger pan,
  // pinch or slider zoom) — no fiddly handles. The initial view frames the
  // auto-detected stamp.
  const [stampCrop, setStampCrop] = useState<StampCropSession | null>(null);
  // k = displayed px per natural image px; tx/ty = the image's top-left offset
  // inside the frame, in displayed px.
  const [cropView, setCropView] = useState<{ k: number; tx: number; ty: number }>({ k: 1, tx: 0, ty: 0 });
  const [frame, setFrame] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const cropPointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const cropGesture = useRef<{ k: number; tx: number; ty: number; cx: number; cy: number; dist: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => { if (defaultName && !name) setName(defaultName); }, [defaultName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size the pad's backing store to its CSS box × DPR so strokes stay crisp
  // and un-squashed. Mobile browsers fire window resizes constantly (URL bar
  // collapse on scroll, the keyboard opening for the name field) — so refit
  // ONLY when the pad's own box actually changed, and carry existing strokes
  // across instead of wiping a half-drawn signature.
  useEffect(() => {
    if (alreadySigned || done) return;
    const c = canvasRef.current;
    if (!c) return;
    const last = { w: 0, h: 0 };
    const fit = () => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (Math.abs(r.width - last.w) < 1 && Math.abs(r.height - last.h) < 1) return;
      const prev = last.w > 0 ? c.toDataURL('image/png') : null;
      last.w = r.width; last.h = r.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (prev) {
        // A real reflow (rotation): redraw the previous strokes into the new box.
        const i = new Image();
        i.onload = () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(i, 0, 0, c.width, c.height); ctx.restore(); };
        i.src = prev;
      } else {
        setDrawn(false);
      }
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(c);
    else window.addEventListener('resize', fit);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', fit); };
  }, [alreadySigned, done]);

  const pos = (e: React.PointerEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { drawing.current = true; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); if (!drawn) setDrawn(true); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current!; const ctx = c.getContext('2d')!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); setDrawn(false); };

  const stampMissing = !!stamp?.required && !stampImage;
  const canSubmit = drawn && agreed && !!name.trim() && !busy && !disabledReason && !stampMissing;

  const onStampFile = async (file: File | undefined | null) => {
    if (!file) return;
    setStampErr(null);
    try { setStampCrop(await loadStampForCrop(file)); }
    catch (e) { setStampErr(e instanceof Error ? e.message : 'Could not read that image'); }
  };

  // ── Crop interactions ── the frame is FIXED; the photo moves under it.
  // One-finger drag pans, two fingers pinch-zoom (anchored on the gesture's
  // centre), and the slider zooms around the frame centre — the friendly
  // avatar-cropper pattern, no handles to grab. The view is clamped so the
  // photo always covers the whole frame.
  const clampView = (v: { k: number; tx: number; ty: number }, img: HTMLImageElement, f: { w: number; h: number }) => {
    const kMin = Math.max(f.w / img.width, f.h / img.height);
    const k = Math.min(Math.max(v.k, kMin), kMin * 10);
    const tx = Math.min(0, Math.max(f.w - img.width * k, v.tx));
    const ty = Math.min(0, Math.max(f.h - img.height * k, v.ty));
    return { k, tx, ty };
  };

  // Measure the frame whenever a crop session opens. The editor lives in a
  // full-screen popup, so the frame can be generous: the card's width, and up
  // to ~55% of the viewport height — a tall phone photo gets real room.
  useEffect(() => {
    if (!stampCrop) return;
    const measure = () => {
      const w = cropBoxRef.current?.clientWidth ?? 0;
      if (w) setFrame({ w, h: Math.max(200, Math.min(Math.round(window.innerHeight * 0.55), Math.round(w * 0.9))) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [stampCrop]);

  // Initial view: frame the auto-detected stamp box (whole photo when
  // detection couldn't isolate it), centred.
  useEffect(() => {
    if (!stampCrop || !frame.w) return;
    const { img, box } = stampCrop;
    const k = Math.min(frame.w / box.w, frame.h / box.h);
    const tx = frame.w / 2 - (box.x + box.w / 2) * k;
    const ty = frame.h / 2 - (box.y + box.h / 2) * k;
    setCropView(clampView({ k, tx, ty }, img, frame));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stampCrop, frame.w, frame.h]);

  const gestureAnchor = () => {
    const pts = [...cropPointers.current.values()];
    return {
      cx: pts.reduce((a, p) => a + p.x, 0) / pts.length,
      cy: pts.reduce((a, p) => a + p.y, 0) / pts.length,
      dist: pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
    };
  };
  const cropPointerDown = (e: React.PointerEvent) => {
    if (!stampCrop) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    cropPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cropGesture.current = { ...cropView, ...gestureAnchor() };
  };
  const cropPointerMove = (e: React.PointerEvent) => {
    const g = cropGesture.current;
    if (!g || !stampCrop || !cropPointers.current.has(e.pointerId)) return;
    cropPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { cx, cy, dist } = gestureAnchor();
    const k = dist > 0 && g.dist > 0 ? g.k * (dist / g.dist) : g.k;
    // Keep the image point that was under the gesture's centre pinned to it.
    const rect = cropBoxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const imgX = (g.cx - rect.left - g.tx) / g.k, imgY = (g.cy - rect.top - g.ty) / g.k;
    const tx = (cx - rect.left) - imgX * k, ty = (cy - rect.top) - imgY * k;
    setCropView(clampView({ k, tx, ty }, stampCrop.img, frame));
  };
  const cropPointerUp = (e: React.PointerEvent) => {
    cropPointers.current.delete(e.pointerId);
    cropGesture.current = cropPointers.current.size ? { ...cropView, ...gestureAnchor() } : null;
  };
  const cropZoomTo = (k: number) => {
    if (!stampCrop || !frame.w) return;
    const cx = frame.w / 2, cy = frame.h / 2;
    const imgX = (cx - cropView.tx) / cropView.k, imgY = (cy - cropView.ty) / cropView.k;
    setCropView(clampView({ k, tx: cx - imgX * k, ty: cy - imgY * k }, stampCrop.img, frame));
  };
  const acceptCrop = () => {
    if (!stampCrop || !frame.w) return;
    // The frame's rectangle, mapped back into the photo's natural pixels.
    const { k, tx, ty } = cropView;
    try { setStampImage(compressStampCrop(stampCrop.img, { x: -tx / k, y: -ty / k, w: frame.w / k, h: frame.h / k })); }
    catch { setStampErr('Could not process that image'); }
    URL.revokeObjectURL(stampCrop.url);
    setStampCrop(null);
  };
  const cancelCrop = () => {
    if (stampCrop) URL.revokeObjectURL(stampCrop.url);
    setStampCrop(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      const signatureImage = canvasRef.current!.toDataURL('image/png');
      const clientMeta = collectClientMeta();
      const geo = await collectGeo();
      await onSign({ signatureImage, signatoryName: name.trim(), consent: true, clientMeta, geo, stampImage: stamp ? stampImage : null });
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign');
    } finally { setBusy(false); }
  };

  const signed = alreadySigned || done;

  if (signed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ecf7f1', border: '1px solid #bfe3d6', borderRadius: 16, padding: '14px 18px' }}>
        <CheckCircle2 size={18} style={{ color: '#16a34a', flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1916' }}>Signed as {signerRole}</div>
          {signerName && <div style={{ fontSize: 12, color: '#6b6860' }}>{signerName}{onBehalfOf ? ` — on behalf of ${onBehalfOf}` : ''}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1 — identity line */}
      <div style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '11px 12px', borderRadius: 12, background: '#eef8f3', border: '1px solid #bfe6d4' }}>
        <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 9, display: 'grid', placeItems: 'center', background: '#fff', border: '1px solid #bfe6d4', color: '#0b7a54' }}>
          <BadgeCheck size={20} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.09em', color: '#6b6860', fontWeight: 700 }}>Signing as {signerRole}</div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', color: '#1a1916', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{signerName || '—'}</div>
          {onBehalfOf && <div style={{ fontSize: 11.5, color: '#0b7a54', fontWeight: 600, marginTop: 2 }}>on behalf of {onBehalfOf}</div>}
        </div>
      </div>

      {/* 2 — signature pad */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b6860', fontWeight: 700 }}>Signature</span>
          <button type="button" onClick={clear} style={{ background: 'none', border: 0, fontSize: 12, color: '#6b6860', cursor: 'pointer' }}>Clear</button>
        </div>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 168, border: '1px solid #d8d6d0', borderRadius: 10, background: '#fafaf8', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        />
        <input
          value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
          style={{ width: '100%', fontSize: 14, padding: '9px 11px', border: '1px solid #e3e0d9', borderRadius: 10, marginTop: 10, boxSizing: 'border-box' }}
        />
      </div>

      {/* 2b — company stamp (commercial leases, customer side) */}
      {stamp && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b6860', fontWeight: 700 }}>
              Company stamp{stamp.required ? '' : ' (optional)'}
            </span>
            {stampImage && (
              <button type="button" onClick={() => setStampImage(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'none', border: 0, fontSize: 12, color: '#6b6860', cursor: 'pointer' }}>
                <X size={12} /> Remove
              </button>
            )}
          </div>
          {stampImage ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #d8d6d0', borderRadius: 10, background: '#fafaf8', padding: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stampImage} alt="Company stamp" style={{ maxHeight: 84, maxWidth: 160, objectFit: 'contain' }} />
              <span style={{ fontSize: 12, color: '#6b6860' }}>This is exactly how your stamp will appear beside your signature. If it looks wrong or cut, remove it and try again.</span>
            </div>
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1.5px dashed #d8d6d0', borderRadius: 10, background: '#fafaf8', padding: '18px 12px', cursor: 'pointer', color: '#6b6860', fontSize: 13, fontWeight: 600 }}>
              <Stamp size={16} />
              Upload your company stamp
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden
                onChange={e => { void onStampFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
          <p style={{ fontSize: 11.5, color: '#9b9890', margin: '6px 0 0' }}>
            {stamp.required
              ? 'Commercial contracts are signed with the company stamp — upload it as an image (PNG or JPEG).'
              : 'If your business signs with a stamp, add it here as an image (PNG or JPEG).'}
            {' '}<strong style={{ color: '#6b6860' }}>For the cleanest result, use your digital stamp file. Photographing a paper stamp instead? Stamp it on plain white paper and capture just the stamp, in good light with no shadows.</strong>
          </p>
          {stampErr && <p style={{ fontSize: 12, color: '#b91c1c', margin: '4px 0 0' }}>{stampErr}</p>}

          {/* Crop popup — opens the moment a photo is chosen, so the customer
               never hunts for an inline editor further down the page. The
               frame is FIXED and is the crop; the photo moves under it. */}
          {stampCrop && (
            <div
              onClick={e => { if (e.target === e.currentTarget) cancelCrop(); }}
              style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(26,25,22,0.66)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            >
              <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1916', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Stamp size={15} /> Crop your company stamp
                  </span>
                  <button type="button" onClick={cancelCrop} aria-label="Close"
                    style={{ background: 'none', border: 0, color: '#6b6860', cursor: 'pointer', padding: 4 }}>
                    <X size={16} />
                  </button>
                </div>
                <div
                  ref={cropBoxRef}
                  onPointerDown={cropPointerDown} onPointerMove={cropPointerMove}
                  onPointerUp={cropPointerUp} onPointerCancel={cropPointerUp}
                  style={{ position: 'relative', width: '100%', height: frame.h || 260, overflow: 'hidden', borderRadius: 10, border: '2px solid #2e9f82', background: '#1a1916', touchAction: 'none', userSelect: 'none', cursor: 'grab' }}
                >
                  {frame.w > 0 && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={stampCrop.url} alt="Move and zoom until your stamp fills the frame"
                      draggable={false}
                      style={{
                        position: 'absolute', left: 0, top: 0,
                        width: stampCrop.img.width * cropView.k,
                        height: stampCrop.img.height * cropView.k,
                        maxWidth: 'none',
                        transform: `translate(${cropView.tx}px, ${cropView.ty}px)`,
                        pointerEvents: 'none',
                      }} />
                  )}
                </div>
                <p style={{ fontSize: 11.5, color: '#6b6860', margin: '8px 0 6px' }}>
                  Move the photo until your stamp fills the frame — drag with a finger, pinch or slide to zoom. Everything inside the frame goes on the contract.
                </p>
                <input
                  type="range" aria-label="Zoom"
                  min={frame.w ? Math.max(frame.w / stampCrop.img.width, frame.h / stampCrop.img.height) : 1}
                  max={(frame.w ? Math.max(frame.w / stampCrop.img.width, frame.h / stampCrop.img.height) : 1) * 10}
                  step={(frame.w ? Math.max(frame.w / stampCrop.img.width, frame.h / stampCrop.img.height) : 1) / 50}
                  value={cropView.k}
                  onChange={e => cropZoomTo(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#2e9f82', margin: '0 0 10px' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={acceptCrop}
                    style={{ flex: 1, background: '#2e9f82', color: '#fff', border: 0, borderRadius: 10, padding: '11px 14px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                    Confirm stamp
                  </button>
                  <button type="button" onClick={cancelCrop}
                    style={{ background: '#fff', color: '#6b6860', border: '1px solid #e3e0d9', borderRadius: 10, padding: '11px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3 — mandatory terms */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#1a1916', cursor: 'pointer', padding: 12, borderRadius: 11, border: '1px solid #e3e0d9', background: '#f6fbf8' }}>
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 2 }} />
        <span>{termsText} {ESIGN_CONSENT_TEXT}</span>
      </label>

      {/* 4 — sign button */}
      <button
        type="button" onClick={submit} disabled={!canSubmit}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: canSubmit ? '#2e9f82' : '#e3e0d9', color: canSubmit ? '#fff' : '#9b9890', border: 0, borderRadius: 11, padding: '12px 18px', fontSize: 14, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />} {submitLabel ?? `Sign as ${signerRole}`}
      </button>
      {disabledReason && !err && <p style={{ fontSize: 11.5, color: '#6b6860', margin: '-4px 0 0', textAlign: 'center' }}>{disabledReason}</p>}
      {!disabledReason && !canSubmit && !err && (
        <p style={{ fontSize: 11.5, color: '#6b6860', margin: '-4px 0 0', textAlign: 'center' }}>
          {stampMissing && drawn && agreed && !!name.trim()
            ? 'Upload your company stamp to enable'
            : `Draw your signature${stampMissing ? ', upload your company stamp' : ''} and tick the box to enable`}
        </p>
      )}
      {err && <p style={{ fontSize: 12, color: '#b91c1c', margin: '-4px 0 0' }}>{err}</p>}
    </div>
  );
}
