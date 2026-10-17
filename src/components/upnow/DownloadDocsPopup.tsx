'use client';

/**
 * "Download documents" for the contract binder: a header button that opens a
 * popup listing every AVAILABLE document on the page (generated ones — payment
 * plan / receipts / agreement — and stored uploads), lets the user tick the ones
 * they want, then combines the selection into ONE PDF (pdf-lib) and saves it.
 * Every document starts on its own page: PDF parts are copied page-by-page,
 * image parts are placed one-per-A4-page, fitted with margins.
 *
 * Stored files are fetched through the SAME-ORIGIN byte proxy
 * (GET /api/documents/:id/file) — never straight from the bucket, whose signed
 * URLs would need a GCS CORS rule to be fetch-readable. Generated documents
 * build their bytes on demand via the same generators the inline previews use.
 */
import { useMemo, useState } from 'react';
import { triggerBrowserDownload } from '@/lib/downloadDoc';
import type { PDFDocument, PDFImage } from 'pdf-lib';

export interface MergePart { bytes: Uint8Array; mime?: string }

export interface MergeDocItem {
  /** Stable key for selection state. */
  id: string;
  label: string;
  /** Section heading in the popup ("Rental documents" / "Tenant & KYC"). */
  group: string;
  /** Number of underlying files (shown as "· N files" when > 1). */
  count?: number;
  /** false → listed but NOT ticked by default (e.g. loose "other" uploads). */
  preselected?: boolean;
  /** Produce the item's file bytes (one or more files, in order). */
  make: () => Promise<MergePart[]>;
}

/** Fetch a stored document's raw bytes through the same-origin API proxy. */
export async function fetchStoredDocBytes(documentId: number): Promise<MergePart> {
  const res = await fetch(`/api/documents/${documentId}/file`, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: res.headers.get('content-type') ?? undefined,
  };
}

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 36;

const isPdfBytes = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
const isPngBytes = (b: Uint8Array) => b.length > 2 && b[0] === 0x89 && b[1] === 0x50;
const isJpgBytes = (b: Uint8Array) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8;

/** Decode any browser-displayable image (webp, …) to PNG bytes via canvas. */
async function rasterToPng(bytes: Uint8Array, mime?: string): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart], { type: mime || 'image/*' });
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  const png: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('image conversion failed'))), 'image/png'));
  return new Uint8Array(await png.arrayBuffer());
}

/**
 * Rasterise a PDF's pages to PNGs with pdf.js — the fallback when pdf-lib can't
 * parse a real-world scan (pdf.js is far more tolerant; it's what the binder
 * previews already render with, so anything viewable stays mergeable).
 */
async function pdfToPngPages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  // pdf.js transfers (detaches) the buffer it's given — hand it a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out: Uint8Array[] = [];
  const MAX_PAGES = 40;
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    const png: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('rasterise failed'))), 'image/png'));
    out.push(new Uint8Array(await png.arrayBuffer()));
  }
  return out;
}

function addImagePage(out: PDFDocument, img: PDFImage) {
  const page = out.addPage([A4_W, A4_H]);
  const scale = Math.min((A4_W - MARGIN * 2) / img.width, (A4_H - MARGIN * 2) / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, { x: (A4_W - w) / 2, y: (A4_H - h) / 2, width: w, height: h });
}

/** Append one file to the output PDF — PDFs keep their pages, images get one fitted A4 page. */
async function appendPart(out: PDFDocument, part: MergePart): Promise<void> {
  const { bytes, mime } = part;
  if (isPdfBytes(bytes) || (mime ?? '').includes('pdf')) {
    try {
      const { PDFDocument: PdfDoc } = await import('pdf-lib');
      const src = await PdfDoc.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(p => out.addPage(p));
    } catch {
      // Scans pdf-lib can't parse → rasterise with pdf.js, one image page each.
      for (const png of await pdfToPngPages(bytes)) addImagePage(out, await out.embedPng(png));
    }
    return;
  }
  let img: PDFImage | null = null;
  try {
    if (isPngBytes(bytes)) img = await out.embedPng(bytes);
    else if (isJpgBytes(bytes)) img = await out.embedJpg(bytes);
  } catch { /* exotic encoding (e.g. some progressive JPEGs) → canvas re-encode below */ }
  if (!img) img = await out.embedPng(await rasterToPng(bytes, mime));
  addImagePage(out, img);
}

const overlayCss: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(26,25,22,.45)', display: 'grid', placeItems: 'center', padding: 16 };
const cardCss: React.CSSProperties = { width: 'min(540px, 100%)', maxHeight: '84vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' };
const groupCss: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a948d', margin: '14px 0 6px' };
const rowCss: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 13.5, color: '#14201a' };
const primaryBtn: React.CSSProperties = { fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: '1px solid #047246', background: '#047246', color: '#fff', cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 10, border: '1px solid #dcd8d0', background: '#fff', color: '#4a4742', cursor: 'pointer' };

function DownloadDocsModal({ items, fileName, onClose }: { items: MergeDocItem[]; fileName: string; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.filter(i => i.preselected !== false).map(i => i.id)));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const groups = useMemo(() => {
    const order: string[] = [];
    for (const it of items) if (!order.includes(it.group)) order.push(it.group);
    return order.map(g => ({ name: g, items: items.filter(i => i.group === g) }));
  }, [items]);
  const allSelected = selected.size === items.length;

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const download = async () => {
    const picked = items.filter(i => selected.has(i.id));
    if (!picked.length) return;
    setBusy(true);
    setWarning(null);
    try {
      const { PDFDocument: PdfDoc } = await import('pdf-lib');
      const out = await PdfDoc.create();
      const skipped: string[] = [];
      for (let i = 0; i < picked.length; i++) {
        const item = picked[i];
        setProgress(`Preparing ${item.label} (${i + 1} of ${picked.length})…`);
        try {
          const parts = await item.make();
          for (const part of parts) await appendPart(out, part);
        } catch (e) {
          console.warn('[download-docs] skipped', item.label, e);
          skipped.push(item.label);
        }
      }
      if (out.getPageCount() === 0) {
        setWarning('None of the selected documents could be read — nothing to download.');
        return;
      }
      setProgress('Combining into one PDF…');
      const bytes = await out.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      triggerBrowserDownload(url, fileName);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      if (skipped.length) {
        setWarning(`Downloaded without: ${skipped.join(', ')} (couldn't be read).`);
      } else {
        onClose();
      }
    } catch (e) {
      setWarning(e instanceof Error ? e.message : 'Download failed — please try again.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div style={overlayCss} onClick={busy ? undefined : onClose}>
      <div style={cardCss} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #efece6' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#14201a' }}>Download documents</div>
          <div style={{ fontSize: 12.5, color: '#5f6b63', marginTop: 3 }}>
            Pick what to include — the selection is combined into a single PDF, each document on its own pages.
          </div>
        </div>
        <div style={{ padding: '4px 14px 10px', overflowY: 'auto', flex: 1 }}>
          <label style={{ ...rowCss, fontWeight: 700, marginTop: 10, background: '#faf9f7' }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(items.map(i => i.id)))}
              style={{ width: 15, height: 15, accentColor: '#047246' }}
            />
            Select all
            <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 12, color: '#8a948d' }}>{selected.size} of {items.length}</span>
          </label>
          {groups.map(g => (
            <div key={g.name}>
              <div style={groupCss}>{g.name}</div>
              {g.items.map(it => (
                <label key={it.id} style={{ ...rowCss, background: selected.has(it.id) ? '#f4faf7' : undefined }}>
                  <input
                    type="checkbox"
                    checked={selected.has(it.id)}
                    onChange={() => toggle(it.id)}
                    style={{ width: 15, height: 15, accentColor: '#047246', flexShrink: 0 }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                  {(it.count ?? 1) > 1 && <span style={{ fontSize: 11.5, color: '#8a948d', flexShrink: 0 }}>· {it.count} files</span>}
                </label>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #efece6', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, color: warning ? '#b3593a' : '#5f6b63', flex: 1, minWidth: 0 }}>
            {busy ? progress : warning ?? ''}
          </div>
          <button type="button" style={ghostBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            style={{ ...primaryBtn, opacity: busy || selected.size === 0 ? 0.6 : 1 }}
            onClick={download}
            disabled={busy || selected.size === 0}
          >
            {busy ? 'Preparing…' : `Download ${selected.size || ''} as one PDF`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DownloadDocsButton({ items, fileName, style, className }: {
  items: MergeDocItem[];
  fileName: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setOpen(true)} title="Combine selected documents into one PDF and download">
        ⬇ Download
      </button>
      {open && <DownloadDocsModal items={items} fileName={fileName} onClose={() => setOpen(false)} />}
    </>
  );
}
