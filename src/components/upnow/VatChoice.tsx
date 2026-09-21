'use client';

/**
 * An amount and "is VAT in it?" as ONE field — for money the landlord pays out
 * (maintenance bills, AMC contracts, AMC payments and bills, visit quotations).
 * The VAT choice sits inside the amount box on the right; once VAT applies, one
 * quiet line under the box spells out before VAT + VAT = total.
 *
 * The VAT figure can be typed over to match the supplier's invoice to the fil
 * (their rounding of 5% is often a few fils off ours).
 */
import { useState } from 'react';
import { splitVat, aed2, type VatMode } from '@/lib/vatSplit';

const SHORT: { mode: VatMode; label: string }[] = [
  { mode: 'none', label: 'No VAT' },
  { mode: 'exclusive', label: '+ 5% VAT' },
  { mode: 'inclusive', label: 'VAT incl.' },
];

export function AmountWithVat({ amount, onAmount, mode, onMode, vatOverride, onVatOverride, size = 'md', placeholder, autoFocus, className, accent = '#1a7a52' }: {
  /** The amount as typed (string from the input). */
  amount: string;
  onAmount: (v: string) => void;
  mode: VatMode;
  onMode: (m: VatMode) => void;
  /** The supplier's exact VAT, when it differs from 5% by rounding. Omit both to hide the option. */
  vatOverride?: string;
  onVatOverride?: (v: string) => void;
  /** md = a form field (full width); sm = a one-line entry row (compact, split shown on hover). */
  size?: 'md' | 'sm';
  placeholder?: string;
  autoFocus?: boolean;
  /** Width / extra classes for the box (sm rows pass e.g. 'w-52'). */
  className?: string;
  accent?: string;
}) {
  const [editingVat, setEditingVat] = useState(false);
  const typed = Number(amount) || 0;
  const fig = splitVat(typed, mode, vatOverride != null && vatOverride.trim() !== '' ? Number(vatOverride) : null);
  const showSplit = typed > 0 && mode !== 'none';
  const sm = size === 'sm';
  const splitText = `${aed2(fig.net)} + VAT ${aed2(fig.vat)} = ${aed2(fig.total)}`;

  const box = (
    <div className={`flex items-stretch bg-white border border-[#e6e8e6] focus-within:border-[var(--acc)] overflow-hidden ${sm ? 'rounded-md' : 'rounded-lg w-full'} ${className ?? ''}`}
      style={{ ['--acc' as string]: accent }} title={sm && showSplit ? splitText : undefined}>
      <input type="number" min="0" step="0.01" inputMode="decimal" value={amount} placeholder={placeholder} autoFocus={autoFocus}
        onChange={e => { onAmount(e.target.value); onVatOverride?.(''); }}
        className={`flex-1 min-w-0 bg-transparent focus:outline-none ${sm ? 'text-[12px] px-2.5 py-1.5' : 'text-sm px-3 py-2'}`} />
      <select value={mode} aria-label="VAT" title="Is VAT in that amount?"
        onChange={e => { onMode(e.target.value as VatMode); onVatOverride?.(''); setEditingVat(false); }}
        className={`shrink-0 border-l border-[#e6e8e6] bg-[#f6f7f6] font-semibold cursor-pointer focus:outline-none ${sm ? 'text-[11px] px-1.5' : 'text-xs px-2'} ${mode === 'none' ? 'text-[#5b615e]' : 'text-[var(--acc)]'}`}>
        {SHORT.map(v => <option key={v.mode} value={v.mode}>{v.label}</option>)}
      </select>
    </div>
  );
  if (sm) return box;

  return (
    <div>
      {box}
      {showSplit && (
        <p className="text-[11px] text-[#8a8f8c] mt-1">
          {aed2(fig.net)} + VAT{' '}
          {editingVat && onVatOverride ? (
            <input type="number" min="0" step="0.01" autoFocus value={vatOverride ?? ''} placeholder={String(splitVat(typed, mode).vat)}
              onChange={e => onVatOverride(e.target.value)} onBlur={() => setEditingVat(false)}
              className="w-20 border border-[#e6e8e6] rounded px-1 py-0 text-[11px] font-semibold text-[#1c1f1d] focus:outline-none" />
          ) : (
            <span className="font-semibold text-[#5b615e]">{aed2(fig.vat)}</span>
          )}
          {' = '}<span className="font-semibold text-[#1c1f1d]">{aed2(fig.total)}</span>
          {onVatOverride && !editingVat && (
            <button type="button" onClick={() => setEditingVat(true)} className="ml-1.5 underline cursor-pointer hover:text-[#5b615e]">edit VAT</button>
          )}
        </p>
      )}
    </div>
  );
}
