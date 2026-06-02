/**
 * Customer-side contract print page.
 *
 * Renders the Dubai Unified Tenancy Contract as a real vector PDF via
 * @react-pdf/renderer (reliable multi-page, crisp text, correct Arabic) — loaded
 * client-only because the PDF viewer needs the browser. Includes addendum pages
 * with signatures.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';

function FullScreenLoader() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#52555a' }}>
      <Loader2 className="animate-spin" size={36} style={{ color: '#fff' }} />
    </div>
  );
}

// @react-pdf must run client-side only.
const EjariContractViewer = dynamic(() => import('@/components/contract/EjariContractPdf'), {
  ssr: false,
  loading: () => <FullScreenLoader />,
});

export default function TenantContractPrintPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<EjariContractData | null>(null);
  const [addendums, setAddendums] = useState<EjariAddendum[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const [c, aRaw] = await Promise.all([
          fetch(`/api/contracts/tenant/${params.id}`, { credentials: 'include' }).then((r) => {
            if (!r.ok) throw new Error(`Error ${r.status}`);
            return r.json();
          }),
          fetch(`/api/contracts/${params.id}/addendums`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
        ]);

        const adds: EjariAddendum[] = Array.isArray(aRaw) ? aRaw : [];
        // For DOCX addendums, extract the text so it renders inline in the PDF.
        const enriched = await Promise.all(
          adds.map(async (a) => {
            const isDocx = (a.mimeType || '').includes('word') || /\.docx?$/i.test(a.fileUrl || '');
            if (!isDocx) return a;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const mod: any = await import('mammoth/mammoth.browser');
              const mammoth = mod.default ?? mod;
              const buf = await (await fetch(a.fileUrl)).arrayBuffer();
              const out = await mammoth.extractRawText({ arrayBuffer: buf });
              const lines = String(out.value || '').split(/\n+/).map((s: string) => s.trim()).filter(Boolean);
              return lines.length ? { ...a, lines } : a;
            } catch {
              return a; // fall back to a reference line if the file can't be read
            }
          }),
        );

        if (!cancelled) {
          setData(c as EjariContractData);
          setAddendums(enriched);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();

    return () => { cancelled = true; };
  }, [params?.id]);

  if (error) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', color: '#c00', padding: 32 }}>
        Failed to load contract: {error}
      </div>
    );
  }
  if (!data) return <FullScreenLoader />;

  return <EjariContractViewer data={data} addendums={addendums} />;
}
