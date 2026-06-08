'use client';

import { useEffect, useState } from 'react';
import { fillEjariPdf } from '@/lib/ejariFill';
import type { EjariContractData, EjariAddendum } from './EjariContractPdf';

/**
 * Fills the official Dubai Ejari template with the contract data (client-side,
 * pdf-lib) and returns an object-URL for the resulting PDF to embed in an
 * <iframe>. Re-runs when the contract ref / signature / addendum set changes.
 */
export function useFilledEjari(data: EjariContractData, addendums: EjariAddendum[]) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stable dependency key — avoids refetch loops when parents pass fresh objects.
  const key = `${data.ref}|${(data.signatures || []).map(s => `${s.role}:${s.signedAt}`).join(',')}|${addendums.map(a => a.id).join(',')}`;

  useEffect(() => {
    let cancelled = false;
    let objUrl: string | null = null;
    setUrl(null); setError(null);
    fillEjariPdf(data, addendums)
      .then(bytes => {
        if (cancelled) return;
        objUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
        setUrl(objUrl);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to render contract'); });
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { url, error };
}
