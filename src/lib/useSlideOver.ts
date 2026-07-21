'use client';

import { useEffect, useRef } from 'react';

/**
 * Overlay (slide-over / full-screen modal) dismissal helper.
 *
 * - Makes the browser **Back** button CLOSE the overlay instead of navigating
 *   away from the page (a history entry is pushed on open; Back pops it → close).
 * - Returns a `dismiss` callback that the X button / backdrop / ESC all route
 *   through, so every close path is identical and the history stack stays clean.
 *
 * Kept intentionally minimal and side-effect-safe (SSR guarded).
 */
export function useBackClose(onClose: () => void): () => void {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.history.pushState({ __overlay: true }, '');
    const onPop = () => onCloseRef.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Explicit closes go through Back so the entry we pushed is always consumed
  // (keeps the stack clean); falls back to a direct close.
  return () => {
    if (typeof window !== 'undefined' && (window.history.state as { __overlay?: boolean } | null)?.__overlay) {
      window.history.back();
    } else {
      onCloseRef.current();
    }
  };
}
