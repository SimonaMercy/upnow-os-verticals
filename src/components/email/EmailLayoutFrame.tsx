'use client';

/**
 * One email shown as its writer laid it out — tables, bold, pictures — inside a
 * sealed frame: no script runs in it, it loads nothing but pictures, and its
 * links open in a new tab. As tall as the email. The earlier emails quoted
 * underneath fold away, one click to see, as in the text view. When the layout
 * cannot be had, the text is shown instead (`fallback`).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { emailApi, type Rp } from '@/lib/emailApi';
import { cleanLayout, type CleanLayout } from '@/lib/emailLayout';

/** Folding and unfolding an email must not fetch it again. */
const seen = new Map<string, Promise<CleanLayout | null>>();
function layoutOf(rp: Rp, messageId: number): Promise<CleanLayout | null> {
  const key = `${rp ?? ''}:${messageId}`;
  let p = seen.get(key);
  if (!p) {
    p = emailApi.layout(rp, messageId).then((r) => cleanLayout(r.html));
    p.catch(() => seen.delete(key));
    seen.set(key, p);
  }
  return p;
}

export function EmailLayoutFrame({ rp, messageId, fallback }: { rp: Rp; messageId: number; fallback: ReactNode }) {
  /** undefined while it is fetched; null when there is nothing to show. */
  const [layout, setLayout] = useState<CleanLayout | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const [height, setHeight] = useState(80);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let live = true;
    layoutOf(rp, messageId).then((l) => { if (live) setLayout(l); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [rp, messageId]);

  /** As tall as the email — measured, since the frame cannot say so itself (no script runs in it). */
  const fit = useCallback(() => {
    const html = frame.current?.contentDocument?.documentElement;
    if (!html) return;
    const scrollbar = html.scrollWidth > html.clientWidth ? 18 : 0;
    setHeight(Math.ceil(html.getBoundingClientRect().height) + scrollbar + 2);
  }, []);

  const onLoad = () => {
    fit();
    // Pictures arrive after the text; each one can make the email taller.
    for (const img of Array.from(frame.current?.contentDocument?.images ?? [])) {
      if (!img.complete) { img.addEventListener('load', fit); img.addEventListener('error', fit); }
    }
    window.setTimeout(fit, 400);
  };

  // Narrower (the side panel opened, the window shrank) means taller.
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout, fit]);

  if (failed || layout === null) return <>{fallback}</>;
  if (layout === undefined) {
    return <div className="flex items-center gap-1.5 py-2 text-xs text-[#9b9890]"><Loader2 size={12} className="animate-spin" /> Opening the email…</div>;
  }
  return (
    <div>
      <iframe ref={frame} title="Email as it was written" srcDoc={showQuoted || !layout.short ? layout.full : layout.short} onLoad={onLoad}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
        className="block w-full border-0 bg-transparent" style={{ height }} />
      {layout.short && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowQuoted((v) => !v)} aria-expanded={showQuoted}
            className="text-[11px] text-[#6b6860] border border-[#e8e6e0] rounded-full px-2.5 py-0.5 hover:border-[#9b9890] cursor-pointer">
            {showQuoted ? 'Hide earlier emails' : 'Earlier emails quoted below'}
          </button>
        </div>
      )}
    </div>
  );
}
