'use client';

/**
 * Full-screen, VIEW-ONLY preview of a saved addendum's terms — the rendered PDF
 * (plain layout + per-page signature block). Used from the Templates list and
 * the /units layout addendum, without entering the editor.
 */
import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { AddendumTerms } from '@/lib/addendumTerms';

const AddendumTermsPreview = dynamic(() => import('@/components/contract/AddendumTermsPreview'), {
  ssr: false,
  loading: () => <div className="h-full grid place-items-center text-[#cfcfcf] text-sm"><Loader2 size={16} className="animate-spin" /></div>,
});

export default function AddendumPreviewModal({ terms, title, onClose }: {
  terms: AddendumTerms;
  title?: string;
  onClose: () => void;
}) {
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

  return (
    <div className="fixed inset-0 z-[70] bg-[#52555a] flex flex-col">
      <div className="px-5 py-3 bg-white border-b border-[#efece6] flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <h3 className="font-semibold text-base text-[#1a1916] truncate">{title || 'Addendum preview'}</h3>
          <p className="text-xs text-[#9b9890]">How the addendum looks on the contract, with the signature block on each page.</p>
        </div>
        <button onClick={onClose} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--primary,#2e9f82)' }}>
          <X size={16} /> Close
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <AddendumTermsPreview terms={terms} height={h} />
      </div>
    </div>
  );
}
