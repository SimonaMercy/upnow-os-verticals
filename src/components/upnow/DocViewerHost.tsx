'use client';

/**
 * The single mount point for the in-portal document viewer (see lib/docViewer).
 * Rendered once at the app root; renders nothing until `openDocViewer(...)` is
 * called. Every document is painted onto a watermarked <canvas> by
 * <SecureDocCanvas/> so the underlying file URL is absent from the DOM and the
 * browser offers no "Save image / frame as". Right-click, drag and text-select
 * are disabled here too. There is deliberately NO download / "open in new tab"
 * control — customer documents are viewable only inside the portal.
 *
 * Two presentations, one viewer — so the canvas / watermark / anti-exfiltration
 * rules can never drift apart between them:
 *   - `modal` — the centred dialog. Owns the screen, stacks every document.
 *   - `dock`  — a rail down the right edge, no backdrop, page stays live behind
 *               it. For reading a document INTO a form (recording cheques).
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { X, FileText, Files, RotateCw, ChevronLeft, ChevronRight, PanelRightClose } from 'lucide-react';
import { useDocViewerState, closeDocViewer, type DocViewerDoc, type DocViewerState } from '@/lib/docViewer';
import { SecureDocCanvas } from './SecureDocCanvas';
import { cleanLayout } from '@/lib/emailLayout';
import { useBackClose } from '@/lib/useSlideOver';

const captionOf = (d: DocViewerDoc) =>
  d.caption ?? d.displayName ?? d.documentKey?.replace(/_/g, ' ') ?? null;

/** 0391 — an email filed as it was received (the bill copy, the proof of payment): shown as the mailbox shows it. */
const isHtml = (d: DocViewerDoc) =>
  (d.mimeType ?? '').startsWith('text/html') || /\.html?(\?|$)/i.test(d.fileUrl ?? '');

/**
 * The email in a sealed frame: fetched by its document id same-origin (the bucket
 * denies anonymous reads), cleaned like the mailbox view (no script runs, it loads
 * nothing but pictures), with the viewer's watermark over it.
 */
function HtmlDocFrame({ doc, watermark }: { doc: DocViewerDoc; watermark: string }) {
  const [html, setHtml] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = doc.id != null
          ? await fetch(`/api/documents/${doc.id}/file`, { credentials: 'include', cache: 'no-store' })
          : await fetch(doc.fileUrl!, { cache: 'no-store' });
        const text = res.ok ? await res.text() : '';
        const clean = text ? cleanLayout(text) : null;
        if (live) setHtml(clean ? clean.full : null);
      } catch { if (live) setHtml(null); }
    })();
    return () => { live = false; };
  }, [doc.id, doc.fileUrl]);
  if (html === undefined) return <div className="px-4 py-6 text-xs text-[#8a948d]">Opening the email…</div>;
  if (html === null) return <div className="px-4 py-6 text-xs text-[#8a948d]">This email could not be shown.</div>;
  return (
    <div className="relative">
      <iframe title="Email as it was received" srcDoc={html} sandbox="" referrerPolicy="no-referrer"
        className="block w-full border-0 bg-white" style={{ height: '70vh' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-end justify-end p-2 text-[10px] text-[#8a948d]/70 select-none">{watermark}</div>
    </div>
  );
}

const isImage = (d: DocViewerDoc) =>
  (d.mimeType ?? '').startsWith('image/') ||
  /\.(jpe?g|png|gif|webp|avif|heic|bmp|svg)(\?|$)/i.test(d.fileUrl ?? '');

export function DocViewerHost() {
  const state = useDocViewerState();
  const docked = state?.mode === 'dock';
  const token = state?.token;
  const pathname = usePathname();

  // Browser Back closes the viewer instead of navigating away; ESC / backdrop / X
  // route through the same path. Active only while a document is open. See useBackClose.
  const dismiss = useBackClose(closeDocViewer, !!state);
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    // The dock deliberately does NOT lock page scroll — the whole point is that
    // the page behind it stays usable while a document is up. It marks the body
    // instead, so the app shell can inset itself and nothing ends up underneath.
    if (docked) {
      document.body.classList.add('doc-dock-open');
      return () => {
        window.removeEventListener('keydown', onKey);
        document.body.classList.remove('doc-dock-open');
      };
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [state, dismiss, docked]);

  // The viewer store outlives a client-side route change, and the dock — unlike
  // the modal — leaves the nav clickable, so it is genuinely possible to walk to
  // another page with a document still pinned open. Close it on the way out
  // rather than hanging one lead's cheque over an unrelated screen. Closed
  // directly, not via dismiss(): dismiss() is history.back(), which would undo
  // the navigation the user just made.
  const routeAtOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!docked) { routeAtOpen.current = null; return; }
    if (routeAtOpen.current === null) routeAtOpen.current = pathname;
    else if (routeAtOpen.current !== pathname) closeDocViewer();
  }, [docked, token, pathname]);

  if (!state) return null;
  // Keyed on the open token, so every open remounts with rotation upright and
  // the dock paged to the document that was clicked — no reset effects needed.
  return docked
    ? <DocDock key={state.token} state={state} dismiss={dismiss} />
    : <DocModal key={state.token} state={state} dismiss={dismiss} />;
}

/** The right-hand rail: one document at a time, page still live beside it. */
function DocDock({ state, dismiss }: { state: DocViewerState; dismiss: () => void }) {
  const { docs, title, watermark, startIndex } = state;
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(startIndex);
  const multi = docs.length > 1;
  const i = Math.min(page, docs.length - 1);
  const doc = docs[i];
  const cap = captionOf(doc);

  return (
    // No backdrop and no aria-modal: this is a complementary panel, not a dialog —
    // the form beside it must keep taking clicks and keystrokes.
    <aside className="doc-dock" role="complementary" aria-label={cap ?? title}>
      <div className="doc-dock-head">
        <h3 className="doc-dock-title">
          {multi ? <Files size={14} /> : <FileText size={14} />}
          <span className="truncate">{cap ?? title}</span>
        </h3>
        <div className="doc-dock-acts">
          <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)}
            aria-label="Rotate document" title="Rotate 90°" className="doc-dock-btn"><RotateCw size={15} /></button>
          <button type="button" onClick={dismiss} aria-label="Close preview" title="Close preview" className="doc-dock-btn">
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>
      {multi && (
        <div className="doc-dock-nav">
          <button type="button" className="doc-dock-btn" aria-label="Previous document"
            disabled={i === 0} onClick={() => setPage(i - 1)}><ChevronLeft size={15} /></button>
          <span className="doc-dock-count">{i + 1} of {docs.length}</span>
          <button type="button" className="doc-dock-btn" aria-label="Next document"
            disabled={i === docs.length - 1} onClick={() => setPage(i + 1)}><ChevronRight size={15} /></button>
        </div>
      )}
      <div
        className="doc-dock-body select-none"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
      >
        {isHtml(doc) ? <HtmlDocFrame key={doc.fileUrl} doc={doc} watermark={watermark} /> : (
        <SecureDocCanvas
          key={doc.fileUrl}
          fileUrl={doc.fileUrl!}
          isImage={isImage(doc)}
          caption={cap}
          watermark={watermark}
          rotation={rotation}
        />)}
      </div>
    </aside>
  );
}

/** The centred dialog: every document stacked in one scrollable feed. */
function DocModal({ state, dismiss }: { state: DocViewerState; dismiss: () => void }) {
  const { docs, title, watermark } = state;
  const [rotation, setRotation] = useState(0);
  const multi = docs.length > 1;
  const heading = multi ? `${title} (${docs.length})` : (captionOf(docs[0]) ?? title);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={dismiss} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#e4e9e5]">
          <h3 className="text-sm font-semibold text-[#14201a] flex items-center gap-2 min-w-0">
            {multi ? <Files size={16} className="text-[#047246] shrink-0" /> : <FileText size={16} className="text-[#047246] shrink-0" />}
            <span className="truncate">{heading}</span>
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              aria-label="Rotate document"
              title="Rotate 90°"
              className="flex items-center gap-1 text-xs font-medium text-[#5f6b63] hover:text-[#14201a] cursor-pointer px-2 py-1 rounded-md hover:bg-[#eef1ef]"
            >
              <RotateCw size={16} /> Rotate
            </button>
            <button type="button" onClick={dismiss} aria-label="Close" className="text-[#5f6b63] hover:text-[#14201a] cursor-pointer"><X size={18} /></button>
          </div>
        </div>
        <div
          className="overflow-y-auto px-5 py-4 space-y-4 bg-[#eef1ef] select-none"
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          {docs.map((d, i) => {
            const cap = captionOf(d);
            return (
              <figure key={`${d.fileUrl}-${i}`} className="bg-white rounded-xl border border-[#e4e9e5] overflow-hidden m-0">
                {multi && cap && (
                  <figcaption className="px-4 py-2 text-xs font-semibold text-[#46534c] border-b border-[#efeee9]">{cap}</figcaption>
                )}
                {isHtml(d) ? <HtmlDocFrame doc={d} watermark={watermark} /> : (
                <SecureDocCanvas
                  fileUrl={d.fileUrl!}
                  isImage={isImage(d)}
                  caption={cap}
                  watermark={watermark}
                  rotation={rotation}
                />)}
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}
