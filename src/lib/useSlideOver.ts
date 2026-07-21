import { useCallback, useEffect, useRef, useState } from 'react';

/** Duration of the slide-in / slide-out animation (keep in sync with the
 *  `.slideover-panel` keyframes in globals.css). Lives here — alongside the
 *  behaviour it drives — and is re-exported from PropertyFormModal for the
 *  modules that have long imported it from there. */
export const SLIDEOVER_MS = 380;

/**
 * Browser-Back-to-close for full-viewport overlays (modals, slide-overs,
 * takeovers). Because these overlays cover the whole screen they LOOK like a
 * page, so people instinctively press the browser Back button (or the edge-swipe
 * gesture) to leave them — which, without this, navigates away from the page
 * underneath instead. On activate we push a throwaway same-URL history entry;
 * pressing Back pops it (no real navigation), fires `popstate`, and we treat it
 * as a close. `dismiss()` (wired to every UI close path — X, backdrop, ESC,
 * Cancel, save-then-close) goes through `history.back()` too, so the pushed
 * entry is always consumed and the close is driven from the single popstate
 * path — the overlay never leaves a stray entry on the stack.
 *
 * `active` marks whether the overlay is currently shown. Overlays mounted only
 * while open can leave it at the default `true`; overlays that stay mounted and
 * toggle an `open` prop must pass that prop, so the entry is pushed on open and
 * cleared on close.
 *
 * Returns `dismiss` — call it from every UI close affordance instead of onClose.
 * For overlays with the right-to-left slide animation use `useSlideOver`, which
 * builds on this and adds the slide-out; plain (non-animated) modals use this
 * hook directly so they close instantly.
 */
export function useBackClose(onClose: () => void, active: boolean = true) {
  // Latest onClose, read at fire-time so the popstate listener never re-binds.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Guards the close so it fires once, however many dismiss signals arrive
  // (Back + a stray click, say). Reset each time the overlay (re)activates.
  const consumedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    consumedRef.current = false;
    window.history.pushState({ __overlay: true }, '');
    const onPop = () => {
      if (consumedRef.current) return;
      consumedRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [active]);

  return useCallback(() => {
    if (consumedRef.current) return;
    window.history.back();
  }, []);
}

/**
 * Close behaviour for the right-to-left full-screen SLIDE-OVER panels (property
 * / unit / layout detail popups + the property / unit forms). Adds the slide-out
 * animation on top of {@link useBackClose}: `dismiss` plays the reverse slide
 * (`closing`), then calls onClose (which unmounts the panel) once the animation
 * has finished — while Back still closes the panel instead of navigating away.
 *
 * Usage:
 *   const { closing, dismiss } = useSlideOver(onClose);
 *   // scrim / back button / ESC / save → onClick={dismiss}
 *   // className={`slideover-panel${closing ? ' closing' : ''}`}
 */
export function useSlideOver(onClose: () => void, active: boolean = true) {
  const [closing, setClosing] = useState(false);

  // The "close" we hand to useBackClose plays the slide-out first, then unmounts.
  const startSlideOut = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => onClose(), SLIDEOVER_MS);
  }, [onClose]);

  const dismiss = useBackClose(startSlideOut, active);

  // Clear the slide-out latch when (re)activating so a reused instance (a panel
  // that toggles `open`) slides in cleanly again.
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClosing(false);
  }, [active]);

  return { closing, dismiss };
}
