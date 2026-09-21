'use client';

/**
 * A photo gallery: tapping a thumbnail opens a full-screen viewer over the page
 * (never a new tab) — large photo, previous / next, a thumbnail strip, "3 / 8",
 * the photo's caption. ← / → step, Esc / browser Back / the backdrop close.
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useBackClose } from '@/lib/useSlideOver';

export interface GalleryPhoto { id: number | string; url: string; caption?: string | null }

export function PhotoLightbox({ photos, start, onClose }: { photos: GalleryPhoto[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const dismiss = useBackClose(onClose);
  const n = photos.length;
  const step = (d: number) => setI(x => (x + d + n) % n);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
      else if (e.key === 'ArrowLeft' && n > 1) step(-1);
      else if (e.key === 'ArrowRight' && n > 1) step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, dismiss]);

  const p = photos[i];
  if (!p) return null;
  const nav = 'flex items-center justify-center w-11 h-11 shrink-0 rounded-full bg-white/15 hover:bg-white/25 text-white cursor-pointer';
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[rgba(12,20,15,.88)]" onClick={dismiss}>
      <div className="flex items-center gap-3 px-5 py-4 text-white" onClick={e => e.stopPropagation()}>
        <span className="text-[13px] font-semibold">{i + 1} / {n}</span>
        {p.caption && <span className="text-[13px] text-white/75 truncate">{p.caption}</span>}
        <button type="button" onClick={dismiss} aria-label="Close" className="ml-auto flex items-center justify-center w-9 h-9 rounded-[10px] bg-white/15 hover:bg-white/25 cursor-pointer"><X size={18} /></button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center gap-4 px-4">
        {n > 1 && <button type="button" aria-label="Previous photo" onClick={e => { e.stopPropagation(); step(-1); }} className={nav}><ChevronLeft size={24} /></button>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.url} alt={p.caption ?? 'Photo'} onClick={e => e.stopPropagation()} className="min-w-0 max-w-[min(1000px,100%)] max-h-full object-contain rounded-xl" />
        {n > 1 && <button type="button" aria-label="Next photo" onClick={e => { e.stopPropagation(); step(1); }} className={nav}><ChevronRight size={24} /></button>}
      </div>
      {n > 1 && (
        <div className="flex gap-2 justify-center px-4 py-4 overflow-x-auto" onClick={e => e.stopPropagation()}>
          {photos.map((ph, k) => (
            <button key={ph.id} type="button" onClick={() => setI(k)} aria-label={`Photo ${k + 1}`}
              className={`w-16 h-12 shrink-0 rounded-lg overflow-hidden border-2 cursor-pointer ${k === i ? 'border-[#2e9f82] opacity-100' : 'border-transparent opacity-50 hover:opacity-80'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ph.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
