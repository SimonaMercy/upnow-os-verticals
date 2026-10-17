/**
 * Look for the Leases - Monthly report and its in-report lease record — the
 * UpNow marketspace design: Plus Jakarta Sans for the interface, Roboto Serif
 * for page titles. Both are self-hosted (public/fonts/marketspace, declared in
 * globals.css), so nothing is fetched at build time. Scoped to these views via
 * `.leases-theme` (the rest of the app now uses the same font globally). Also carries the print fix.
 */
const CSS = `
/* Marketspace look: Plus Jakarta Sans for the interface, Roboto Serif for page titles. */
.leases-theme { font-family: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.leases-theme button, .leases-theme input, .leases-theme select, .leases-theme textarea { font-family: inherit; }
.leases-theme .ms-serif { font-family: 'Roboto Serif', Georgia, serif; font-weight: 500; letter-spacing: -0.015em; }
.leases-theme .font-mono, .leases-theme kbd { font-family: inherit; font-variant-numeric: tabular-nums; letter-spacing: 0; }
/* Popover entrance — a quick fade + lift from the pill it belongs to. */
@keyframes lm-pop-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }
.leases-theme .lm-pop { animation: lm-pop-in .14s cubic-bezier(.2,.8,.2,1); }

/* Motion, in the marketspace portal's vocabulary: sections rise in one after the
   other, bars grow from the baseline, meters fill from the left, rings draw round,
   and the one thing that needs attention breathes in gold. --i staggers a set. */
@keyframes lm-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.leases-theme .lm-up { animation: lm-up .5s cubic-bezier(.2,.7,.2,1) both; animation-delay: calc(var(--i, 0) * 70ms); }
.leases-theme .lm-row { animation: lm-up .35s cubic-bezier(.2,.7,.2,1) both; animation-delay: calc(min(var(--i, 0), 14) * 28ms); }
@keyframes lm-grow-y { from { transform: scaleY(0); } }
.leases-theme .lm-bar { transform-origin: bottom; animation: lm-grow-y .7s cubic-bezier(.3,.8,.2,1) both; animation-delay: calc(.15s + var(--i, 0) * 40ms); }
@keyframes lm-grow-x { from { transform: scaleX(0); } }
.leases-theme .lm-fill { transform-origin: left; animation: lm-grow-x .9s cubic-bezier(.3,.8,.2,1) both; animation-delay: calc(.2s + var(--i, 0) * 30ms); }
@keyframes lm-fade { from { opacity: 0; } }
.leases-theme .lm-fade { animation: lm-fade .4s both; animation-delay: calc(.45s + var(--i, 0) * 40ms); }
@keyframes lm-ring { to { stroke-dashoffset: var(--off); } }
.leases-theme .lm-ring-fg { stroke-dasharray: var(--c); stroke-dashoffset: var(--c); animation: lm-ring 1.4s .3s cubic-bezier(.3,.8,.2,1) forwards; }
@keyframes lm-zoom { from { opacity: 0; transform: scale(.7); } }
.leases-theme .lm-zoom { animation: lm-zoom .6s .5s cubic-bezier(.3,1.4,.5,1) both; }
@keyframes lm-pin { from { opacity: 0; transform: translate(-50%, -50%) scale(.3); } }
.leases-theme .lm-pin { animation: lm-pin .45s cubic-bezier(.3,1.5,.5,1) both; animation-delay: calc(.5s + var(--i, 0) * 90ms); }
/* Gold: a ping for "act now", a slow glow for the one figure that matters. */
.leases-theme .lm-ping { position: relative; }
.leases-theme .lm-ping::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid #f5c26b; animation: lm-ping-k 1.8s ease-out infinite; }
@keyframes lm-ping-k { from { opacity: .9; transform: scale(.6); } to { opacity: 0; transform: scale(1.9); } }
@keyframes lm-glow-k { 50% { box-shadow: 0 0 0 6px rgba(245,194,107,.2); } }
.leases-theme .lm-glow { animation: lm-glow-k 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .leases-theme .lm-pop, .leases-theme .lm-up, .leases-theme .lm-row, .leases-theme .lm-bar, .leases-theme .lm-fill,
  .leases-theme .lm-fade, .leases-theme .lm-zoom, .leases-theme .lm-pin, .leases-theme .lm-glow, .leases-theme .lm-ping::after { animation: none; }
  .leases-theme .lm-ring-fg { animation: none; stroke-dashoffset: var(--off); }
}

/* Print. The dashboard shell is a fixed-height frame (h-screen + overflow-hidden)
   that scrolls inside <main>, so a browser prints one screenful and drops the
   rest. While this report is on the page — and only then — every ancestor of it
   is released to grow, and everything that is not on its path (sidebar, top
   bar) is left out, so the whole register flows over as many pages as it needs. */
@media print {
  @page { size: A4; margin: 12mm; }
  html:has(.leases-theme), body:has(.leases-theme), body *:has(.leases-theme) {
    height: auto !important; min-height: 0 !important; max-height: none !important;
    overflow: visible !important; display: block !important; position: static !important;
    padding: 0 !important; margin: 0 !important; background: #fff !important; transform: none !important;
  }
  body:has(.leases-theme) *:not(:has(.leases-theme)):not(.leases-theme):not(.leases-theme *):not(style):not(link):not(script) { display: none !important; }
  .leases-theme { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff !important; font-size: 11px; }
  .leases-theme *, .leases-theme *::after { animation: none !important; }
  .leases-theme .lm-ring-fg { stroke-dashoffset: var(--off) !important; }
  .leases-theme table { min-width: 0 !important; width: 100% !important; }
  .leases-theme th, .leases-theme td { padding: 6px 8px !important; }
  .leases-theme tr { break-inside: avoid; }
  .leases-theme thead { display: table-header-group; }
}
`;

export const leasesThemeClass = 'leases-theme';

/** Render once inside the themed wrapper. React hoists the link into <head>. */
export function LeasesThemeStyles() {
  return (
    <>
      <style>{CSS}</style>
    </>
  );
}
