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
import { useEffect } from 'react';
import { X, FileText, Files } from 'lucide-react';
import { useDocViewerState, closeDocViewer, type DocViewerDoc } from '@/lib/docViewer';
import { SecureDocCanvas } from './SecureDocCanvas';

const captionOf = (d: DocViewerDoc) =>
  d.caption ?? d.displayName ?? d.documentKey?.replace(/_/g, ' ') ?? null;

const isImage = (d: DocViewerDoc) =>
  (d.mimeType ?? '').startsWith('image/') ||
  /\.(jpe?g|png|gif|webp|avif|heic|bmp|svg)(\?|$)/i.test(d.fileUrl ?? '');

export function DocViewerHost() {
  const state = useDocViewerState();

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
  const { docs, title, watermark } = state;
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
          <button type="button" onClick={closeDocViewer} aria-label="Close" className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer shrink-0"><X size={18} /></button>
        </div>
        <div
          className="overflow-y-auto px-5 py-4 space-y-4 bg-[#f4f3ef] select-none"
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          {docs.map((d, i) => {
            const cap = captionOf(d);
            return (
              <figure key={`${d.fileUrl}-${i}`} className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden m-0">
                {multi && cap && (
                  <figcaption className="px-4 py-2 text-xs font-semibold text-[#3d3b35] border-b border-[#efeee9]">{cap}</figcaption>
                )}
                <SecureDocCanvas
                  fileUrl={d.fileUrl!}
                  isImage={isImage(d)}
                  caption={cap}
                  watermark={watermark}
                />
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}
