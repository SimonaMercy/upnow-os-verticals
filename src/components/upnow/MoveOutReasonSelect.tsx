'use client';

/**
 * The move-out reason picker — one control, used everywhere a tenancy can end
 * so the same vocabulary is captured on every path (RP terminate / RP direct /
 * customer request / renewal declined-to-vacate).
 *
 * It only renders the <select>; the caller owns the label and layout, because
 * the RP pages style with the v2 `.input` CSS and the customer portal styles
 * with Tailwind. Options are grouped by side (customer-driven / landlord-driven
 * / breach) — the breach codes are RP-only and never shown to a customer.
 */

import {
  MOVE_OUT_SIDE_LABELS, MOVE_OUT_SIDE_ORDER, moveOutReasonOptions,
} from '@/lib/moveOutReasons';

export default function MoveOutReasonSelect({
  value, onChange, audience = 'rp', className = 'input', id, disabled, style,
}: {
  value: string;
  onChange: (code: string) => void;
  audience?: 'rp' | 'customer';
  className?: string;
  id?: string;
  disabled?: boolean;
  /** The customer portal styles inline rather than with the v2 `.input` class. */
  style?: React.CSSProperties;
}) {
  const options = moveOutReasonOptions(audience);
  // 'other' is filed under a side for the report's rollup, but it is not one of
  // those things to a person picking from a list — it goes last, on its own.
  const grouped = options.filter(o => o.code !== 'other');
  const other = options.find(o => o.code === 'other');
  return (
    <select
      id={id}
      className={className}
      style={style}
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">Select a reason…</option>
      {MOVE_OUT_SIDE_ORDER.map(side => {
        const group = grouped.filter(o => o.side === side);
        if (!group.length) return null;
        return (
          <optgroup key={side} label={MOVE_OUT_SIDE_LABELS[side]}>
            {group.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
          </optgroup>
        );
      })}
      {other && <option value={other.code}>{other.label}</option>}
    </select>
  );
}
