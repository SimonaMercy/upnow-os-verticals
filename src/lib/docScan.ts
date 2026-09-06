/**
 * docScan — client-side document scanning (CamScanner-style).
 *
 * Pipeline: photo → detect the document's four corners (OpenCV.js) → let the
 * user adjust them → perspective-warp to a flat top-down page → optional
 * illumination clean-up → JPEG for the normal upload flow.
 *
 * OpenCV.js (~10 MB, self-hosted at /vendor/opencv.js) is injected lazily the
 * first time a scan starts, so ordinary page loads never pay for it. Everything
 * here runs in the browser; the backend receives a plain image file.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ScanPoint = { x: number; y: number };
/** Corners in role order: top-left, top-right, bottom-right, bottom-left. */
export type ScanQuad = [ScanPoint, ScanPoint, ScanPoint, ScanPoint];

// Long-side caps: detection runs on a small copy (speed), the warped output
// keeps enough pixels for ID text to stay legible, and the decoded source is
// bounded so a 48 MP phone photo can't blow the canvas memory budget.
const DETECT_MAX_SIDE = 1000;
const OUTPUT_MAX_SIDE = 3000;
const SOURCE_MAX_SIDE = 3500;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ─── OpenCV loader ────────────────────────────────────────────────────────────

let cvPromise: Promise<any> | null = null;

/** Inject /vendor/opencv.js once and resolve with the ready `cv` module. */
export function loadOpenCV(): Promise<any> {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise<any>((resolve, reject) => {
    const finish = (cv: any) => {
      // Newer builds expose `cv` as a thenable of the module; older ones flip
      // onRuntimeInitialized. Normalise to "resolved module with Mat".
      if (cv && typeof cv.then === "function") {
        cv.then((m: any) => {
          // Emscripten's thenable calls back with the module ITSELF, which
          // still has a .then — resolving a Promise with it would loop
          // forever unwrapping it. Strip .then before resolving.
          try { delete m.then; } catch { /* non-configurable: fall through */ }
          (window as any).cv = m;
          resolve(m);
        }, reject);
      } else if (cv && cv.Mat) {
        resolve(cv);
      } else if (cv) {
        cv.onRuntimeInitialized = () => resolve(cv);
      } else {
        reject(new Error("Scanner engine failed to initialise"));
      }
    };
    const existing = (window as any).cv;
    if (existing) return finish(existing);
    const script = document.createElement("script");
    script.src = "/vendor/opencv.js";
    script.async = true;
    script.onload = () => finish((window as any).cv);
    script.onerror = () => {
      cvPromise = null; // allow a retry on the next scan
      reject(new Error("Could not load the scanner engine"));
    };
    document.head.appendChild(script);
  });
  return cvPromise;
}

// ─── Image helpers ────────────────────────────────────────────────────────────

/** Decode an image file onto a canvas (EXIF-oriented, long side capped). */
export async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const scale = Math.min(1, SOURCE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Assign the 4 points their tl/tr/br/bl roles regardless of input order. */
export function orderQuad(pts: ScanPoint[]): ScanQuad {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.x - a.y - (b.x - b.y));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]];
}

/** A quad inset from the frame edges — the fallback when detection finds nothing. */
export function defaultQuad(width: number, height: number): ScanQuad {
  const mx = width * 0.06;
  const my = height * 0.06;
  return [
    { x: mx, y: my },
    { x: width - mx, y: my },
    { x: width - mx, y: height - my },
    { x: mx, y: height - my },
  ];
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Find the document outline in a photo. Runs on a downscaled copy; returns the
 * corners in full-resolution coordinates, or null when no confident quad exists
 * (busy background, document fills the whole frame, …).
 */
export async function detectDocumentQuad(full: HTMLCanvasElement): Promise<ScanQuad | null> {
  const cv = await loadOpenCV();
  const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(full.width, full.height));
  const w = Math.max(1, Math.round(full.width * scale));
  const h = Math.max(1, Math.round(full.height * scale));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  small.getContext("2d")!.drawImage(full, 0, 0, w, h);

  const src = cv.imread(small);
  const gray = new cv.Mat();
  const working = new cv.Mat();
  let best: ScanQuad | null = null;
  let bestArea = 0;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    // A real document occupies a meaningful share of a deliberate photo.
    const minArea = w * h * 0.12;
    const consider = (contours: any) => {
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const area = Math.abs(cv.contourArea(approx));
          if (area > minArea && area > bestArea) {
            const pts: ScanPoint[] = [];
            for (let j = 0; j < 4; j++) {
              pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
            }
            best = orderQuad(pts);
            bestArea = area;
          }
        }
        approx.delete();
        contour.delete();
      }
    };

    // Pass 1 — edge contours: documents lying on a contrasting surface.
    {
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.Canny(gray, working, 50, 150);
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.dilate(working, working, kernel);
      kernel.delete();
      cv.findContours(working, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      consider(contours);
      contours.delete();
      hierarchy.delete();
    }
    // Pass 2 — brightness split: white paper on a dark surface where soft
    // shadows defeat the edge pass.
    if (!best) {
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.threshold(gray, working, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.findContours(working, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      consider(contours);
      contours.delete();
      hierarchy.delete();
    }
  } finally {
    src.delete();
    gray.delete();
    working.delete();
  }

  if (!best) return null;
  const up = 1 / scale;
  return (best as ScanQuad).map((p) => ({
    x: clamp(p.x * up, 0, full.width),
    y: clamp(p.y * up, 0, full.height),
  })) as ScanQuad;
}

// ─── Warp + enhance ───────────────────────────────────────────────────────────

/** Perspective-flatten the quad region into a top-down page. */
export async function warpDocument(full: HTMLCanvasElement, quad: ScanQuad): Promise<HTMLCanvasElement> {
  const cv = await loadOpenCV();
  const [tl, tr, br, bl] = quad;
  const dist = (a: ScanPoint, b: ScanPoint) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  let h = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  const scale = Math.min(1, OUTPUT_MAX_SIDE / Math.max(w, h, 1));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const src = cv.imread(full);
  const dst = new cv.Mat();
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const out = document.createElement("canvas");
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    cv.imshow(out, dst);
  } finally {
    src.delete();
    dst.delete();
    srcTri.delete();
    dstTri.delete();
    M.delete();
  }
  return out;
}

/**
 * "Clean scan" look: estimate the page illumination from a heavy blur and
 * divide it out (shadows cancel, paper goes white), with the gain capped so
 * genuinely dark regions — the photo on an Emirates ID — aren't blown out.
 */
export function enhanceScan(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;

  // Cheap large-radius blur: shrink hard, let bilinear upscaling smooth it.
  const down = document.createElement("canvas");
  down.width = Math.max(1, Math.round(w / 20));
  down.height = Math.max(1, Math.round(h / 20));
  down.getContext("2d")!.drawImage(src, 0, 0, down.width, down.height);
  const bg = document.createElement("canvas");
  bg.width = w;
  bg.height = h;
  const bgCtx = bg.getContext("2d")!;
  bgCtx.imageSmoothingEnabled = true;
  bgCtx.imageSmoothingQuality = "high";
  bgCtx.drawImage(down, 0, 0, w, h);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const outCtx = out.getContext("2d")!;
  outCtx.drawImage(src, 0, 0);
  const img = outCtx.getImageData(0, 0, w, h);
  const bgImg = bgCtx.getImageData(0, 0, w, h);
  const d = img.data;
  const b = bgImg.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const gain = Math.min(245 / (b[i + c] || 1), 1.7);
      const n = (d[i + c] * gain - 8) * 1.04;
      d[i + c] = n > 255 ? 255 : n < 0 ? 0 : n;
    }
  }
  outCtx.putImageData(img, 0, 0);
  return out;
}

// ─── Export ───────────────────────────────────────────────────────────────────

/** Package the processed canvas as a JPEG File for the normal upload flow. */
export function canvasToJpegFile(canvas: HTMLCanvasElement, originalName: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Could not export the scan"));
        const base = originalName.replace(/\.[^.]+$/, "") || "document";
        resolve(new File([blob], `${base}-scan.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  });
}
