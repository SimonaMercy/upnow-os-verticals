'use client';

/**
 * Shared document reader popup — a left sidebar that lists the documents and a
 * right preview pane that shows each file as a gallery (images inline, PDFs in a
 * chrome-less iframe) with prev/next navigation across every file on file.
 *
 * This mirrors the reader built into the Property / Unit view modals so every
 * surface that previews customer documents looks and behaves the same. View-only
 * by design: documents are previewed in-portal, never downloaded.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { FileText, X, ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import { SecureDocCanvas } from './SecureDocCanvas';
import { currentDocWatermark } from '@/lib/docViewer';
import { useBackClose } from '@/lib/useSlideOver';

export type ReaderFile = { id: string | number; name: string; url: string; mimeType?: string | null };
/** group → optional section heading in the sidebar (e.g. a lease ref). */
export type ReaderSlot = { key: string; label: string; group?: string | null; files: ReaderFile[] };

const C = {
  ink: '#1a1916', ink2: '#2b342e', body: '#5a635c', mute: '#9aa39c',
  green: '#2e9f82', greenT: '#1a7a5a', greenBg: '#eef9f4', greenBg2: '#eef6f1',
  greenBd: '#cfe9df', line: '#e8e6e0', line2: '#eef1ec', line4: '#f4f6f3',
  soft: '#fbfcfb', amber: '#b07415',
};

const isImage = (f: ReaderFile) =>
  (f.mimeType ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(f.url);

export function DocumentReaderModal({ title = 'Documents', summary, slots, initialKey, onClose }: {
  title?: string;
  summary?: string | null;
  slots: ReaderSlot[];
  /** Slot to open on first render; defaults to the first slot that has files. */
  initialKey?: string | null;
  onClose: () => void;
}) {
  const firstWithFiles = slots.find(s => s.files.length > 0)?.key ?? slots[0]?.key ?? null;
  // Computed once when the reader opens — same identity stamp as openDocViewer.
  const [watermark] = useState(() => currentDocWatermark());
  const [activeKey, setActiveKey] = useState<string | null>(initialKey ?? firstWithFiles);
  const [fileIdx, setFileIdx] = useState(0);
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280);
  useEffect(() => {
    const r = () => setVw(window.innerWidth);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  const isTight = vw < 720;

  const rSlot = activeKey ? slots.find(s => s.key === activeKey) ?? null : null;
  const rFiles = rSlot?.files ?? [];
  const rf = Math.min(fileIdx, Math.max(0, rFiles.length - 1));
  const rActive = rFiles[rf] ?? null;

  // Flattened file sequence across every slot — drives the prev/next arrows so
  // the reader steps through all documents "one after the other" like a gallery.
  const seq = useMemo(() => {
    const out: { key: string; idx: number }[] = [];
    slots.forEach(s => s.files.forEach((_, i) => out.push({ key: s.key, idx: i })));
    return out;
  }, [slots]);
  const curPos = seq.findIndex(x => x.key === activeKey && x.idx === rf);
  const goSeq = useCallback((delta: number) => {
    if (!seq.length) return;
    const pos = ((curPos < 0 ? 0 : curPos) + delta + seq.length) % seq.length;
    setActiveKey(seq[pos].key);
    setFileIdx(seq[pos].idx);
  }, [seq, curPos]);

  // Browser Back closes the reader instead of navigating away; ESC / backdrop / X
  // route through the same path. See useBackClose.
  const dismiss = useBackClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
      else if (e.key === 'ArrowLeft') goSeq(-1);
      else if (e.key === 'ArrowRight') goSeq(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss, goSeq]);

  const select = (key: string) => { setActiveKey(key); setFileIdx(0); };

  return (
    <div onClick={dismiss} style={{ position: 'fixed', inset: 0, background: 'rgba(15,25,18,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isTight ? 0 : 22, zIndex: 70 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 940, height: isTight ? '100%' : '90vh', maxHeight: isTight ? '100%' : '90vh', background: '#fff', borderRadius: isTight ? 0 : 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(15,30,22,.42)' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px', borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
          <span style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 9, background: C.greenBg, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{title}</div>
            {summary && <div style={{ fontSize: 11.5, color: C.mute }}>{summary}</div>}
          </div>
          <div onClick={dismiss} style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 9, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.body, cursor: 'pointer' }}><X size={17} /></div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isTight ? 'column' : 'row' }}>
          {/* sidebar — document list */}
          <aside style={{ width: isTight ? 'auto' : 250, flex: '0 0 auto', maxHeight: isTight ? 150 : 'none', overflowY: 'auto', borderRight: isTight ? 'none' : `1px solid ${C.line2}`, borderBottom: isTight ? `1px solid ${C.line2}` : 'none', padding: 10, display: 'flex', flexDirection: 'column', gap: 3, background: C.soft }}>
            {slots.map((s, i) => {
              const attached = s.files.length > 0;
              const selected = s.key === activeKey;
              const showGroup = s.group && (i === 0 || slots[i - 1].group !== s.group);
              return (
                <div key={s.key}>
                  {showGroup && <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.mute, padding: '9px 6px 4px' }}>{s.group}</div>}
                  <div onClick={() => attached && select(s.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 11px', borderRadius: 10, cursor: attached ? 'pointer' : 'default', border: `1px solid ${selected ? C.greenBd : 'transparent'}`, background: selected ? C.greenBg : 'transparent' }}>
                    <span style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: 8, background: selected ? C.green : (attached ? C.greenBg2 : C.line4), color: selected ? '#fff' : (attached ? C.greenT : '#aab2ab'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: attached ? C.greenT : C.amber }}>{attached ? (s.files.length > 1 ? `${s.files.length} files` : 'On file') : 'Not uploaded'}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </aside>

          {/* preview — gallery pane */}
          <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rActive?.name || rSlot?.label || 'Document'}</div>
                <div style={{ fontSize: 11, color: C.greenT, fontWeight: 600 }}>{rActive ? (rFiles.length > 1 ? `File ${rf + 1} of ${rFiles.length} · ${isImage(rActive) ? 'Image' : 'PDF'}` : `${isImage(rActive) ? 'Image' : 'PDF'} · On file`) : 'Not uploaded'}</div>
              </div>
            </div>

            {/* cross-document nav */}
            {rActive && seq.length > 1 && (
              <>
                <div onClick={() => goSeq(-1)} style={{ position: 'absolute', left: 14, top: '58%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: '#fff', border: '1px solid #e2e7e1', boxShadow: '0 4px 14px rgba(20,40,30,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a443d', cursor: 'pointer', zIndex: 5 }}><ChevronLeft size={21} /></div>
                <div onClick={() => goSeq(1)} style={{ position: 'absolute', right: 14, top: '58%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: '#fff', border: '1px solid #e2e7e1', boxShadow: '0 4px 14px rgba(20,40,30,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a443d', cursor: 'pointer', zIndex: 5 }}><ChevronRight size={21} /></div>
                <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(20,40,30,.55)', padding: '5px 12px', borderRadius: 9, zIndex: 5 }}>{(curPos < 0 ? 0 : curPos) + 1} of {seq.length} files</div>
              </>
            )}

            {/* multi-file tabs within a slot */}
            {rFiles.length > 1 && (
              <div style={{ display: 'flex', gap: 8, padding: '11px 16px', borderBottom: `1px solid ${C.line2}`, overflowX: 'auto', background: C.soft, flex: '0 0 auto' }}>
                {rFiles.map((f, i) => (
                  <div key={f.id} onClick={() => setFileIdx(i)} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', flex: '0 0 auto', border: `1px solid ${i === rf ? C.greenBd : C.line}`, background: i === rf ? C.greenBg : '#fff', color: i === rf ? C.greenT : C.body }}>
                    <span style={{ width: 18, height: 22, flex: '0 0 18px', borderRadius: 3, background: '#fff', border: '1px solid #d8e0d9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.greenT, fontSize: 9, fontWeight: 700 }}>{i + 1}</span>
                    <span style={{ whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* preview body */}
            {rActive ? (
              <div
                onContextMenu={e => e.preventDefault()}
                onDragStart={e => e.preventDefault()}
                style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: C.line2, padding: isImage(rActive) ? 22 : 0, userSelect: 'none', WebkitUserSelect: 'none' }}
              >
                <SecureDocCanvas
                  key={`${rActive.id}-${rf}`}
                  fileUrl={rActive.url}
                  isImage={isImage(rActive)}
                  caption={rActive.name}
                  watermark={watermark}
                />
              </div>
            ) : (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, background: C.soft }}>
                <div style={{ textAlign: 'center', maxWidth: 300 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 14, background: '#fff', border: `1px solid ${C.line}`, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><Upload size={22} /></div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: '#3a443d', marginTop: 14 }}>{rSlot?.label}</div>
                  <div style={{ fontSize: 12, color: C.mute, marginTop: 5, lineHeight: 1.5 }}>This document has not been uploaded yet.</div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
