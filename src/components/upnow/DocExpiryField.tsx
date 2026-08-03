'use client';

/**
 * Compact expiry-date input for a single document row. Shown for identity /
 * licence docs (Emirates ID, passport, visa, trade licence) so the uploader —
 * RP OR customer — records when the document expires. Gate its render with
 * `docNeedsExpiry(key)` from `@/lib/docRequirements`; this component is just the
 * field. The value is `yyyy-mm-dd` (native date input); parent owns the state,
 * sends it on upload and/or PATCHes an existing doc when it changes.
 */
import { CalendarClock, Loader2 } from 'lucide-react';

export function DocExpiryField({ value, onChange, onCommit, saving, disabled, className, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  /** Fired on blur — the point the entered date has settled and can be saved. */
  onCommit?: (v: string) => void;
  saving?: boolean;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={className ?? 'mt-2'}>
      <label className="text-[11px] font-semibold text-[#6b6860] flex items-center gap-1 mb-1">
        <CalendarClock size={12} className="text-[#2e9f82]" /> Expiry date
      </label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={e => onChange(e.target.value)}
          onBlur={e => onCommit?.(e.target.value)}
          className="text-sm border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30 disabled:opacity-50"
        />
        {saving && <Loader2 size={13} className="animate-spin text-[#9b9890]" />}
      </div>
    </div>
  );
}
