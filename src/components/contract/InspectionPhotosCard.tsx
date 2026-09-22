'use client';

/**
 * The inspection's photos for the CUSTOMER — shown as a card under the report
 * they are about to sign. The report itself is a rasterised A4 document
 * (InspectionInline) that prints no photos, so without this card the customer
 * agrees to a condition record they never saw the evidence for.
 *
 * Thumbnails open the same full-screen gallery the RP/manager report uses
 * (PhotoLightbox: previous / next, thumbnail strip, "3 / 48"). Read-only.
 *
 * Compact by default: a walk-through can be 40+ photos, and on a phone a full
 * grid pushes the signature box a dozen screens down. So the card shows the
 * first few, the last tile reads "+42", and every tap opens the gallery over
 * ALL the photos — "Show all" expands the grid only for those who want it.
 */
import { useState } from 'react';
import { Camera, ZoomIn } from 'lucide-react';

/** Thumbnails shown before "+N": two rows of three on a phone, one row of six on a desktop. */
const PREVIEW = 6;
import { PhotoLightbox, type GalleryPhoto } from '@/components/upnow/PhotoGallery';

export interface InspectionPhotoLike { id: string; url: string; caption?: string | null }

export function InspectionPhotosCard({ title, photos, hint }: {
  title: string;
  photos: InspectionPhotoLike[];
  /** Small grey line under the title, e.g. "Recorded at move-in, for reference." */
  hint?: string;
}) {
  const [start, setStart] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (!photos.length) return null;
  const gallery: GalleryPhoto[] = photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption || title }));
  const shown = expanded ? photos : photos.slice(0, PREVIEW);
  const hidden = photos.length - shown.length;
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] mt-4 overflow-hidden">
      <div className="px-5 py-3 border-b border-[#f4f3ef] bg-[#fafaf8] flex items-center gap-2">
        <Camera size={15} className="text-[#2e9f82]" />
        <span className="text-sm font-bold text-[#1a1916]">{title} ({photos.length})</span>
        <span className="ml-auto text-[11px] text-[#9b9890] hidden sm:inline">Tap a photo to view it full size</span>
      </div>
      <div className="px-5 py-4">
        {hint && <p className="text-xs text-[#6b6860] mb-3">{hint}</p>}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {shown.map((p, k) => {
            const more = hidden > 0 && k === shown.length - 1;
            return (
              <button key={p.id} type="button" onClick={() => setStart(k)}
                aria-label={more ? `View all ${photos.length} photos` : `View photo ${k + 1} of ${photos.length}`}
                className="relative block w-full aspect-square rounded-lg overflow-hidden border border-[#e8e6e0] bg-[#f4f3ef] cursor-zoom-in">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption || `${title} ${k + 1}`} loading="lazy" className="w-full h-full object-cover" />
                {more ? (
                  /* The last preview tile carries the count of what's not shown — tapping it browses everything. */
                  <span className="absolute inset-0 bg-black/55 text-white flex items-center justify-center text-base font-bold">+{hidden}</span>
                ) : (
                  <span className="absolute bottom-1 right-1 w-[18px] h-[18px] rounded-full bg-black/55 text-white flex items-center justify-center pointer-events-none">
                    <ZoomIn size={11} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {photos.length > PREVIEW && (
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={() => setStart(0)} className="text-xs font-semibold text-[#2e9f82] hover:underline cursor-pointer">
              View all {photos.length} photos
            </button>
            <span className="text-[#d6d4cc]">·</span>
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-[#6b6860] hover:underline cursor-pointer">
              {expanded ? 'Show fewer' : 'Show all here'}
            </button>
          </div>
        )}
      </div>
      {start !== null && <PhotoLightbox photos={gallery} start={start} onClose={() => setStart(null)} />}
    </div>
  );
}
