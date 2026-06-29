'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { pdf, type DocumentProps } from '@react-pdf/renderer';

/**
 * Render a @react-pdf <Document> element to raw PDF bytes + a download object-URL.
 *
 * Pair the returned `bytes` with <EjariCanvas bytes …> to DISPLAY the PDF on a
 * <canvas> (pdf.js) rather than an <iframe src="blob:…pdf">, which renders blank on
 * mobile browsers and is unreliable in production. The object-URL is for the
 * Download button only (a blob download works everywhere; only inline iframe
 * DISPLAY is the problem).
 *
 * `make()` is invoked INSIDE the effect, so handing it a fresh JSX element on every
 * render never re-triggers generation — regeneration is controlled solely by `key`,
 * a stable string that changes only when the document's content changes. Pass
 * `enabled=false` to skip generation entirely (e.g. when a different renderer owns
 * the output for this branch) — hooks must run unconditionally, so this is how a
 * caller opts a branch out without violating the rules of hooks.
 */
export function useReactPdfDoc(
  make: () => ReactElement<DocumentProps>,
  key: string,
  enabled = true,
): { bytes: Uint8Array | null; url: string | null; error: string | null } {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objUrl: string | null = null;
    // All setState lives inside the async callback (not the effect body) to avoid
    // react-hooks/set-state-in-effect cascading renders — same pattern as useFilledEjari.
    (async () => {
      setBytes(null); setUrl(null); setError(null);
      if (!enabled) return;   // a different renderer owns this branch — do no work
      try {
        const blob = await pdf(make()).toBlob();
        const buf = new Uint8Array(await blob.arrayBuffer());
        if (cancelled) return;
        objUrl = URL.createObjectURL(blob);   // same blob powers the download link
        setBytes(buf);
        setUrl(objUrl);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to render PDF');
      }
    })();
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
    // make() is intentionally excluded — regeneration is keyed on `key`/`enabled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { bytes, url, error };
}
