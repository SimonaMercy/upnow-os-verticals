/**
 * The UAE Dirham sign, drawn as a lucide-compatible icon.
 *
 * Every money surface on this platform is in AED, and the app was marking it
 * with lucide's `DollarSign` — a currency it does not deal in. lucide ships no
 * dirham glyph and there is no Unicode codepoint for the 2025 mark either, so it
 * is drawn here: the Latin "D" of the official symbol with the two horizontal
 * strokes through its stem.
 *
 * Deliberately mirrors the lucide icon API (`size`, `className`, `strokeWidth`,
 * `currentColor`, 24-unit viewBox) so it drops straight into any place a lucide
 * icon was used, including `icon={DirhamSign}` props.
 */
import * as React from 'react';

export interface DirhamSignProps extends React.SVGProps<SVGSVGElement> {
  /** Rendered size in px, both axes — same meaning as lucide's `size`. */
  size?: number | string;
}

export function DirhamSign({ size = 24, strokeWidth = 2, ...props }: DirhamSignProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {/* Stem of the D, and its bowl. */}
      <path d="M10 4v16" />
      <path d="M10 4h1a8 8 0 0 1 0 16h-1" />
      {/* The two strokes that make it a dirham rather than a letter. */}
      <path d="M4 9.5h9" />
      <path d="M4 14.5h9" />
    </svg>
  );
}

export default DirhamSign;
