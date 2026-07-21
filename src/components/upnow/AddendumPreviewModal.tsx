'use client';

/**
 * Full-screen, VIEW-ONLY preview of a saved addendum's terms — the rendered PDF
 * (plain layout + per-page signature block). Used from the Templates list and
 * the /units layout addendum, without entering the editor.
 */
import { useState, useEffect } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { AddendumTerms } from '@/lib/addendumTerms';
import { useBackClose } from '@/lib/useSlideOver';

const AddendumTermsPreview = dynamic(() => import('@/components/contract/AddendumTermsPreview'), {
  ssr: false,
  loading: () => <div className="h-full grid place-items-center text-[#cfcfcf] text-sm"><Loader2 size={16} className="animate-spin" /></div>,
});

export default function AddendumPreviewModal({ terms, title, onClose }: {
  terms: AddendumTerms;
  title?: string;
  onClose: () => void;
}) {
  // Browser Back closes this full-screen preview instead of navigating away; the
  // back-arrow / ESC route through the same path. See useBackClose.
  const dismiss = useBackClose(onClose);
  const [h, setH] = useState(600);
  useEffect(() => {
    const calc = () => setH(Math.max(360, window.innerHeight - 96));
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  return (
    <div className="fixed inset-0 z-[70] bg-[#52555a] flex flex-col">
      <div className="px-5 py-3 bg-white border-b border-[#efece6] flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base text-[#1a1916] truncate">{title || 'Addendum preview'}</h3>
          <p className="text-xs text-[#9b9890]">How the addendum looks on the contract, with the signature block on each page.</p>
        </div>
        <button onClick={dismiss} aria-label="Back" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#e7ebe6] text-[#5a635c] hover:bg-[#f6f8f5]">
          <ArrowLeft size={18} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <AddendumTermsPreview terms={terms} height={h} />
      </div>
    </div>
  );
}
