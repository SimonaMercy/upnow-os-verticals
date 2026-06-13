'use client';

/**
 * In-app preview popup for one or more documents (e.g. an Emirates ID's front
 * and back shown together). Images render inline; PDFs render in a chrome-less
 * iframe. Use for a focused "View" action instead of opening a new browser tab.
 */
import { useEffect } from 'react';
import { X, FileText, ExternalLink } from 'lucide-react';

export type PreviewDoc = { id: number; fileUrl: string | null; mimeType?: string | null; caption?: string | null };

const isImage = (d: PreviewDoc) =>
  (d.mimeType ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(d.fileUrl ?? '');

export function DocPreviewModal({ title, docs, onClose }: { title: string; docs: PreviewDoc[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const viewable = docs.filter(d => d.fileUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#e8e6e0]">
          <h3 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2"><FileText size={16} className="text-[#2e9f82]" /> {title}</h3>
          <button type="button" onClick={onClose} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4 bg-[#f4f3ef]">
          {viewable.length === 0 && <p className="text-sm text-[#9b9890] text-center py-8">No file to preview.</p>}
          {viewable.map(d => (
            <figure key={d.id} className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
              {d.caption && (
                <figcaption className="px-4 py-2 text-xs font-semibold text-[#3d3b35] border-b border-[#efeee9] flex items-center justify-between">
                  {d.caption}
                  <a href={d.fileUrl!} target="_blank" rel="noopener noreferrer" className="text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">Open <ExternalLink size={11} /></a>
                </figcaption>
              )}
              {isImage(d) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.fileUrl!} alt={d.caption ?? 'Document'} className="w-full block" />
              ) : (
                <iframe src={`${d.fileUrl!}#toolbar=0&navpanes=0&statusbar=0&view=FitH`} title={d.caption ?? 'Document'} className="w-full h-[70vh] border-0 block bg-white" />
              )}
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
