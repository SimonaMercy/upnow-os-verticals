/**
 * PropertyPhotos — building-photo uploader for a property. Visual design mirrors
 * the Unit Photos uploader (count, drag-to-reorder, COVER badge, dashed empty
 * state, footer hint). Used in BOTH flows:
 *
 *  • EDIT (propertyId set)  → LIVE mode: fetch existing + upload/delete/reorder
 *    immediately against /api/properties/:id/media (reorder persists the cover).
 *  • ADD  (no propertyId)   → PENDING mode: holds File[] in the parent via
 *    value/onChange; the parent uploads them after the property is created.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, X, Loader2, Camera, Plus } from 'lucide-react';

interface PhotoRow { id: number; url: string; caption: string | null; }

const MAX = 20;

export function PropertyPhotos({
  propertyId,
  value,
  onChange,
}: {
  /** When set → live mode (immediate upload/delete/reorder). Absent → pending mode. */
  propertyId?: number;
  /** Pending-mode controlled files (add flow). */
  value?: File[];
  onChange?: (files: File[]) => void;
}) {
  const live = propertyId != null;
  const [items, setItems] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(live);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const pending = value ?? [];

  // Live mode: load existing photos.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/properties/${propertyId}/media`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(`Error ${r.status}`)))
      .then((rows: PhotoRow[]) => { if (!cancelled) setItems(rows); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [propertyId, live]);

  // Pending-mode previews — object URLs revoked when the file list changes.
  const previews = useMemo(() => pending.map(f => URL.createObjectURL(f)), [pending]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  const tiles = live
    ? items.map(it => ({ key: String(it.id), src: it.url }))
    : previews.map((src, i) => ({ key: `p${i}`, src }));
  const count = tiles.length;

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    const images = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!images.length) { setError('Only image files are allowed'); return; }
    if (count + images.length > MAX) { setError(`Maximum ${MAX} photos per property`); return; }
    setError(null);

    if (!live) { onChange?.([...pending, ...images]); return; }

    setBusy(true);
    for (const file of images) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`/api/properties/${propertyId}/media`, {
          method: 'POST', body: fd, credentials: 'include',
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const row: PhotoRow = await res.json();
        setItems(prev => [...prev, row]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      }
    }
    setBusy(false);
  };

  const remove = async (idx: number) => {
    if (!live) { onChange?.(pending.filter((_, i) => i !== idx)); return; }
    const target = items[idx];
    if (!target) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/media/${target.id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok && res.status !== 204) throw new Error(`Delete failed (${res.status})`);
      setItems(prev => prev.filter(i => i.id !== target.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
    setBusy(false);
  };

  const reorder = async (from: number, to: number) => {
    if (from === to) return;
    if (!live) {
      const arr = [...pending];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      onChange?.(arr);
      return;
    }
    const arr = [...items];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setItems(arr); // optimistic
    try {
      const res = await fetch(`/api/properties/${propertyId}/media/order`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: arr.map(i => i.id) }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Reorder failed (${res.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reorder failed');
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="sr-only"
        onChange={e => { pick(e.target.files); e.target.value = ''; }}
      />

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-[#6b6860]">
          Property Photos
          <span className="text-[#9b9890] font-normal ml-1">({count}/{MAX})</span>
          {count > 1 && <span className="text-[#9b9890] font-normal ml-2">· drag to set cover</span>}
        </p>
        <div className="flex items-center gap-2">
          {busy && <Loader2 size={13} className="animate-spin text-[#2e9f82]" />}
          {count > 0 && count < MAX && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1 text-xs text-[#2e9f82] font-medium hover:text-[#1f6655] cursor-pointer"
            >
              <ImagePlus size={13} /> Add Photos
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-[11px] text-[#b91c1c] mb-2">{error}</p>}

      {loading ? (
        <div className="w-full flex items-center justify-center border-2 border-dashed border-[#e8e6e0] rounded-xl p-5">
          <Loader2 size={18} className="animate-spin text-[#2e9f82]" />
        </div>
      ) : count === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center border-2 border-dashed border-[#e8e6e0] rounded-xl p-5 hover:border-[#2e9f82] hover:bg-[#f0fdf8] transition-colors cursor-pointer"
        >
          <Camera size={22} className="text-[#c8c6c0] mb-1.5" />
          <span className="text-xs text-[#9b9890]">Click to add photos</span>
        </button>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {tiles.map((tile, idx) => (
            <div
              key={tile.key}
              draggable
              onDragStart={() => { dragIdxRef.current = idx; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragIdxRef.current;
                if (from !== null && from !== idx) reorder(from, idx);
                dragIdxRef.current = null;
                setDragOverIdx(null);
              }}
              onDragEnd={() => { dragIdxRef.current = null; setDragOverIdx(null); }}
              className={`relative rounded-lg overflow-hidden border group transition-all select-none
                ${idx === 0 ? 'w-24 h-24' : 'w-20 h-20'}
                ${dragOverIdx === idx && dragIdxRef.current !== idx
                  ? 'border-[#2e9f82] ring-2 ring-[#2e9f82] scale-105'
                  : idx === 0 ? 'border-[#2e9f82]' : 'border-[#e8e6e0]'}
              `}
              style={{ cursor: 'grab' }}
            >
              {idx === 0 && (
                <div className="absolute bottom-0 left-0 right-0 bg-[#2e9f82] text-white text-[9px] font-bold text-center py-0.5 z-10 leading-tight">
                  COVER
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tile.src} alt="" className="w-full h-full object-cover pointer-events-none" draggable={false} />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); remove(idx); }}
                disabled={busy}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10 disabled:opacity-40"
              >
                <X size={10} />
              </button>
            </div>
          ))}

          {count < MAX && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-[#e8e6e0] flex items-center justify-center cursor-pointer hover:border-[#2e9f82] hover:bg-[#f0fdf8] transition-colors"
            >
              <Plus size={16} className="text-[#c8c6c0]" />
            </button>
          )}
        </div>
      )}

      <p className="text-[10px] text-[#9b9890] mt-1">
        JPEG, PNG or WebP · up to {MAX} per property · drag thumbnails to reorder · first image is the cover.
      </p>
    </div>
  );
}
