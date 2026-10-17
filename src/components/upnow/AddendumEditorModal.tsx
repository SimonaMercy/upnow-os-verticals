'use client';

/**
 * FULL-SCREEN addendum editor — the document-style AddendumTermsEditor (write
 * left / large live preview right) taking the whole viewport. Optionally hosts
 * an `options` bar (e.g. template name + category) and a configurable primary
 * action, so the entire create/edit flow happens in one full-screen view.
 * Controlled — term edits flow to `onChange`.
 */
import { useState, useEffect, type ReactNode } from 'react';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import AddendumTermsEditor from './AddendumTermsEditor';
import type { AddendumTerms } from '@/lib/addendumTerms';
import { useBackClose } from '@/lib/useSlideOver';

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

  // Browser Back closes this full-screen editor instead of navigating away; the
  // close (X) routes through the same path. See useBackClose.
  const dismiss = useBackClose(onClose);
  const primary = onPrimary ?? dismiss;

  return (
    <div className="fixed inset-0 z-[70] bg-white flex flex-col">
      <div className="px-5 py-3 border-b border-[#efece6] flex items-center gap-3 shrink-0">
        {/* Back-arrow on the LEFT — matches the detail views' back button. */}
        <button onClick={dismiss} aria-label="Back" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#e7ebe6] text-[#5a635c] hover:bg-[#eef1ef]"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base text-[#14201a] truncate">{title}</h3>
          <p className="text-xs text-[#8a948d] truncate">{subtitle || 'Write the terms on the left; the layout (with the signature block) previews on the right.'}</p>
        </div>
        <button onClick={primary} disabled={primaryDisabled || busy}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--primary,#047246)' }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {primaryLabel}
        </button>
      </div>

      {hasOptions && (
        <div className="px-5 py-3 border-b border-[#efece6] bg-[#f6f8f6] shrink-0">{options}</div>
      )}

      <div className="flex-1 min-h-0 px-5 py-4">
        <AddendumTermsEditor value={value} onChange={onChange} height={h} />
      </div>
    </div>
  );
}
