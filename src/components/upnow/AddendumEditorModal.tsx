'use client';

/**
 * FULL-SCREEN addendum editor — the document-style AddendumTermsEditor (write
 * left / large live preview right) taking the whole viewport. Optionally hosts
 * an `options` bar (e.g. template name + category) and a configurable primary
 * action, so the entire create/edit flow happens in one full-screen view.
 * Controlled — term edits flow to `onChange`.
 */
import { useState, useEffect, type ReactNode } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import AddendumTermsEditor from './AddendumTermsEditor';
import type { AddendumTerms } from '@/lib/addendumTerms';

export default function AddendumEditorModal({
  value, onChange, onClose,
  title = 'Agreement — Addendum',
  subtitle,
  options,
  primaryLabel = 'Done',
  onPrimary,
  primaryDisabled = false,
  busy = false,
}: {
  value: AddendumTerms;
  onChange: (next: AddendumTerms) => void;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Optional controls (name, category, …) shown in a bar above the editor. */
  options?: ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  busy?: boolean;
}) {
  const hasOptions = !!options;
  // Fill the viewport: editor height = screen minus the top bar (+ options bar).
  const [h, setH] = useState(560);
  useEffect(() => {
    const calc = () => setH(Math.max(360, window.innerHeight - (hasOptions ? 188 : 104)));
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [hasOptions]);

  // Lock body scroll while the full-screen editor is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const primary = onPrimary ?? onClose;

  return (
    <div className="fixed inset-0 z-[70] bg-white flex flex-col">
      <div className="px-5 py-3 border-b border-[#efece6] flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <h3 className="font-semibold text-base text-[#1a1916] truncate">{title}</h3>
          <p className="text-xs text-[#9b9890] truncate">{subtitle || 'Write the terms on the left; the layout (with the signature block) previews on the right.'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={primary} disabled={primaryDisabled || busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--primary,#2e9f82)' }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {primaryLabel}
          </button>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] p-1.5 rounded-lg hover:bg-[#f4f3ef]" title="Close"><X size={18} /></button>
        </div>
      </div>

      {hasOptions && (
        <div className="px-5 py-3 border-b border-[#efece6] bg-[#fafaf8] shrink-0">{options}</div>
      )}

      <div className="flex-1 min-h-0 px-5 py-4">
        <AddendumTermsEditor value={value} onChange={onChange} height={h} />
      </div>
    </div>
  );
}
