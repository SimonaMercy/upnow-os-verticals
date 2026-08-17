/**
 * SP-86 · stoppers for live surfaces — nothing should poll or ping forever.
 *
 *   usePageVisible()  → false while the tab is hidden (backgrounded / minimised)
 *   useIdle(ms)       → true after `ms` without pointer / key / touch / scroll;
 *                       returns [idle, wake] so a "Resume" button can clear it
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => setVisible(document.visibilityState === 'visible');
    const t = setTimeout(sync, 0);
    document.addEventListener('visibilitychange', sync);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', sync); };
  }, []);
  return visible;
}

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

export function useIdle(ms: number): [boolean, () => void] {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; setIdle(true); }, ms);
  }, [ms]);
  const wake = useCallback(() => { setIdle(false); arm(); }, [arm]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let last = 0;
    const onActivity = () => {
      // throttle: at most one re-arm per 5 s; once paused, only wake() (the Resume button) restarts
      const now = Date.now();
      if (now - last < 5000) return;
      last = now;
      if (timer.current) arm();
    };
    arm();
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
    };
  }, [arm]);
  return [idle, wake];
}

/** Idle limits (ms) — one place to tune. */
export const LIVE_MAP_IDLE_MS = 30 * 60_000;      // provider live map: stop polling after 30 min without interaction
export const TRACKER_IDLE_MS = 30 * 60_000;       // customer tracker: same
export const TECH_IDLE_OFFLINE_MS = 2 * 60 * 60_000; // technician Available with NO live job: auto go offline after 2 h idle
