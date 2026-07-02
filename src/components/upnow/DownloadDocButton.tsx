'use client';

import { useState } from 'react';
import { downloadStoredDoc } from '@/lib/downloadDoc';

/**
 * Button that downloads a STORED document (by id) cleanly — used for the generated
 * tenancy artifacts (move-in / move-out inspection reports, deposit settlement).
 * Styling is delegated via `className`/`style` so each surface (binder inline
 * styles, v2 `.mini-btn` classes, customer card) can match its own look.
 */
export function DownloadDocButton({
  documentId, portalToken, label = 'Download PDF', className, style, title,
}: {
  documentId: number;
  portalToken?: string | null;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const go = async () => {
    setState('loading');
    try {
      await downloadStoredDoc(documentId, portalToken);
      setState('idle');
    } catch {
      setState('error');
    }
  };
  return (
    <button type="button" onClick={go} disabled={state === 'loading'} className={className} style={style} title={title}>
      {state === 'loading' ? '⏳ Preparing…' : state === 'error' ? '↻ Retry download' : `⬇ ${label}`}
    </button>
  );
}
