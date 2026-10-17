'use client';

/**
 * In-app preview popup for one or more documents (e.g. an Emirates ID's front
 * and back shown together). Images render inline; PDFs render in a chrome-less
 * iframe. Use for a focused "View" action instead of opening a new browser tab.
 */
import { useEffect } from 'react';
import { X, FileText } from 'lucide-react';
import { useBackClose } from '@/lib/useSlideOver';

export type PreviewDoc = { id: number; fileUrl: string | null; mimeType?: string | null; caption?: string | null };

const isImage = (d: PreviewDoc) =>
  (d.mimeType ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(d.fileUrl ?? '');

export function DocPreviewModal({ title, docs, onClose }: { title: string; docs: PreviewDoc[]; onClose: () => void }) {
  // Browser Back closes the modal instead of navigating away; ESC / backdrop / X
  // route through the same path. See useBackClose.
  const dismiss = useBackClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  const viewable = docs.filter(d => d.fileUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={dismiss} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#e4e9e5]">
          <h3 className="text-sm font-semibold text-[#14201a] flex items-center gap-2"><FileText size={16} className="text-[#047246]" /> {title}</h3>
          <button type="button" onClick={dismiss} className="text-[#5f6b63] hover:text-[#14201a] cursor-pointer"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4 bg-[#eef1ef]">
          {viewable.length === 0 && <p className="text-sm text-[#8a948d] text-center py-8">No file to preview.</p>}
          {viewable.map(d => (
            <figure key={d.id} className="bg-white rounded-xl border border-[#e4e9e5] overflow-hidden">
              {d.caption && (
                <figcaption className="px-4 py-2 text-xs font-semibold text-[#46534c] border-b border-[#efeee9]">
                  {d.caption}
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
