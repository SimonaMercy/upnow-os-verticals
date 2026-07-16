'use client';

/**
 * The single mount point for the in-portal document viewer (see lib/docViewer).
 * Rendered once at the app root; renders nothing until `openDocViewer(...)` is
 * called. Every document is painted onto a watermarked <canvas> by
 * <SecureDocCanvas/> so the underlying file URL is absent from the DOM and the
 * browser offers no "Save image / frame as". Right-click, drag and text-select
 * are disabled here too. There is deliberately NO download / "open in new tab"
 * control — customer documents are viewable only inside the portal.
 */
import { useEffect, useState } from 'react';
import { X, FileText, Files, RotateCw, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDocViewerState, closeDocViewer, type DocViewerDoc } from '@/lib/docViewer';
import { downloadStoredDoc } from '@/lib/downloadDoc';
import { SecureDocCanvas } from './SecureDocCanvas';

const captionOf = (d: DocViewerDoc) =>
  d.caption ?? d.displayName ?? d.documentKey?.replace(/_/g, ' ') ?? null;

const isImage = (d: DocViewerDoc) =>
  (d.mimeType ?? '').startsWith('image/') ||
  /\.(jpe?g|png|gif|webp|avif|heic|bmp|svg)(\?|$)/i.test(d.fileUrl ?? '');

export function DocViewerHost() {
  const state = useDocViewerState();
  // Clockwise viewing rotation for sideways scans. Reset each time a new document
  // opens (keyed on the docs array identity).
  const [rotation, setRotation] = useState(0);
  useEffect(() => { setRotation(0); }, [state?.docs]);
  // Id of the document currently being fetched for download (spinner state).
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const handleDownload = async (id: number) => {
    setDownloadingId(id);
    try {
      await downloadStoredDoc(id);
    } catch {
      toast.error('Could not download the document. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDocViewer(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [state]);

  if (!state) return null;
  const { docs, title, watermark, canDownload } = state;
  const multi = docs.length > 1;
  const heading = multi ? `${title} (${docs.length})` : (captionOf(docs[0]) ?? title);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={closeDocViewer} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#e8e6e0]">
          <h3 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2 min-w-0">
            {multi ? <Files size={16} className="text-[#2e9f82] shrink-0" /> : <FileText size={16} className="text-[#2e9f82] shrink-0" />}
            <span className="truncate">{heading}</span>
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              aria-label="Rotate document"
              title="Rotate 90°"
              className="flex items-center gap-1 text-xs font-medium text-[#6b6860] hover:text-[#1a1916] cursor-pointer px-2 py-1 rounded-md hover:bg-[#f4f3ef]"
            >
              <RotateCw size={16} /> Rotate
            </button>
            <button type="button" onClick={closeDocViewer} aria-label="Close" className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer"><X size={18} /></button>
          </div>
        </div>
        <div
          className="overflow-y-auto px-5 py-4 space-y-4 bg-[#f4f3ef] select-none"
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          {docs.map((d, i) => {
            const cap = captionOf(d);
            const downloadable = canDownload && typeof d.id === 'number' && d.id > 0;
            const showBar = (multi && cap) || downloadable;
            return (
              <figure key={`${d.fileUrl}-${i}`} className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden m-0">
                {showBar && (
                  <figcaption className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[#efeee9]">
                    <span className="text-xs font-semibold text-[#3d3b35] truncate">{multi ? cap : ''}</span>
                    {downloadable && (
                      <button
                        type="button"
                        onClick={() => handleDownload(d.id!)}
                        disabled={downloadingId === d.id}
                        title="Download this document"
                        className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:text-[#1a7a5a] cursor-pointer px-2 py-1 rounded-md hover:bg-[#eef9f4] disabled:opacity-60 shrink-0"
                      >
                        {downloadingId === d.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        Download
                      </button>
                    )}
                  </figcaption>
                )}
                <SecureDocCanvas
                  fileUrl={d.fileUrl!}
                  isImage={isImage(d)}
                  caption={cap}
                  watermark={watermark}
                  rotation={rotation}
                />
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}
