'use client';

/**
 * Full-width overlay that hosts the document-style AddendumTermsEditor (write
 * left / live preview right). Used where the inline space is tight (e.g. the
 * /units Plan Terms modal). Controlled — edits flow straight to `onChange`;
 * "Done" just closes.
 */
import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import AddendumTermsEditor from './AddendumTermsEditor';
import type { AddendumTerms } from '@/lib/addendumTerms';

export default function AddendumEditorModal({ value, onChange, onClose }: {
  value: AddendumTerms;
  onChange: (next: AddendumTerms) => void;
  onClose: () => void;
}) {
  // Size the editor to the viewport so both panes are genuinely "big".
  const [h, setH] = useState(560);
  useEffect(() => {
    const calc = () => setH(Math.max(380, Math.min(680, window.innerHeight - 210)));
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(20,19,18,0.6)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-[#efece6] flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-base text-[#1a1916]">Agreement — Addendum</h3>
            <p className="text-xs text-[#9b9890]">Write the terms; the layout (with the signature block) previews on the right.</p>
          </div>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] p-1"><X size={18} /></button>
        </div>
        <div className="p-4 flex-1 min-h-0 overflow-auto">
          <AddendumTermsEditor value={value} onChange={onChange} height={h} />
        </div>
        <div className="px-5 py-3 border-t border-[#efece6] flex justify-end">
          <button onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--primary,#2e9f82)' }}>
            <Check size={15} /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
