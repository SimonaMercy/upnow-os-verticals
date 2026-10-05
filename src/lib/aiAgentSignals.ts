/**
 * Spots an AI agent driving this browser tab — at sign-in or anywhere after —
 * and remembers it in a short-lived cookie, so the backend refuses it
 * (backend: src/auth/ai-agent-guard.ts): no sign-in code, no session, and a
 * session already open is ended.
 *
 * A cookie rather than a request header: it rides every /api call on its own —
 * including the listing page's direct fetches — and the proxy forwards it.
 *
 * Signals:
 *  - webdriver         navigator.webdriver — Playwright, Puppeteer, Selenium and
 *                      the agent tools built on them.
 *  - headless          a HeadlessChrome user-agent.
 *  - claude-in-chrome  the Claude extension adds `claude-agent-*` elements to the
 *                      page while it acts; its style block stays after it stops.
 *  - synthetic-click   a click on a visible button or link that no hand made
 *                      (`isTrusted` false) — how extension agents that script the
 *                      page press buttons. Our own code only clicks file pickers
 *                      and download links that way.
 *  - background-input  a real click or keypress in a tab nobody can see — an
 *                      agent working in a background tab; a person cannot.
 *
 * The first three are certain and are remembered for 30 minutes. The last two
 * are behaviour, which a person's own browser can produce by accident (a
 * password manager pressing "Continue", a remote-desktop window the browser
 * believes is hidden), so they are remembered for 5 minutes only — the person
 * is back in once the tool stops — and one scripted click alone is let go: it
 * takes a second one within two minutes.
 */
export const AI_AGENT_COOKIE = 'upnow_ai_agent';

export const AI_AGENT_BLOCKED_NOTICE =
  'UpNow cannot be used through ChatGPT, Claude or any other AI tool, so you have been signed out. ' +
  'Please sign in yourself, in your own browser, with no AI assistant running. ' +
  'If you are not using one, switch off any browser extension that clicks or fills in pages for you and try again in 5 minutes.';

/** Set by the proxy on every response the backend refused as an AI agent. */
export const AI_AGENT_BLOCKED_HEADER = 'x-upnow-blocked';
export const AI_AGENT_BLOCKED_HEADER_VALUE = 'ai-agent';

/** Certain marks of an agent — everything else is behaviour (see above). */
const CERTAIN = new Set(['webdriver', 'headless', 'claude-in-chrome']);
const CERTAIN_MAX_AGE_S = 30 * 60;
const BEHAVIOUR_MAX_AGE_S = 5 * 60;
const SCRIPTED_CLICK_WINDOW_MS = 2 * 60 * 1000;
const CLAUDE_AGENT_ID = 'claude-agent-';

/** Sign-in screens show the refusal in place instead of being sent to /login. */
const AUTH_PAGES = ['/login', '/verify', '/verify-email', '/register', '/invite', '/forgot-password'];

const CONTROLS =
  'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], ' +
  'input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], select, summary';

const seen = new Set<string>();
let started = false;
let lastScriptedClick = -Infinity;

function onAuthPage(): boolean {
  const path = window.location.pathname;
  return AUTH_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Leave for /login with the reason — the session is already gone (the proxy cleared it). */
export function leaveForAiAgent(): void {
  if (typeof window === 'undefined' || onAuthPage()) return;
  window.location.assign('/login?blocked=ai');
}

/** Ask the backend right away, so a session ends the moment an agent shows up. */
async function checkNow(): Promise<void> {
  if (onAuthPage()) return;
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
    if (res.status !== 403) return;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'AI_AGENT_BLOCKED') leaveForAiAgent();
  } catch {
    // offline — the next API call carries the cookie anyway
  }
}

function remember(signal: string): void {
  const isNew = !seen.has(signal);
  seen.add(signal);
  const maxAge = [...seen].some((s) => CERTAIN.has(s)) ? CERTAIN_MAX_AGE_S : BEHAVIOUR_MAX_AGE_S;
  document.cookie = `${AI_AGENT_COOKIE}=${[...seen].join('.')}; path=/; max-age=${maxAge}; samesite=strict`;
  if (isNew) void checkNow();
}

function isVisibleControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(CONTROLS);
  if (!control || control.matches('a[download], a[href^="blob:"]')) return false;
  if (control.closest('[aria-hidden="true"]')) return false;
  const box = control.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

/**
 * Roughly 180 call sites use a raw `fetch('/api/…')` and never reach api.ts, so
 * the refusal is read off the response header here — whichever call meets it
 * first, the tab leaves for /login.
 */
function leaveOnRefusedFetch(): void {
  const orig = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await orig(input, init);
    if (res.status === 403 && res.headers.get(AI_AGENT_BLOCKED_HEADER) === AI_AGENT_BLOCKED_HEADER_VALUE) {
      leaveForAiAgent();
    }
    return res;
  }) as typeof window.fetch;
}

export function watchForAiAgent(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  leaveOnRefusedFetch();

  if (navigator.webdriver) remember('webdriver');
  if (/HeadlessChrome/i.test(navigator.userAgent)) remember('headless');
  if (document.querySelector(`[id^="${CLAUDE_AGENT_ID}"]`)) remember('claude-in-chrome');

  // The extension appends straight to <head>/<body>, so watching their direct
  // children is enough — no subtree walk on every dashboard re-render.
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node instanceof Element && node.id.startsWith(CLAUDE_AGENT_ID)) {
          remember('claude-in-chrome');
          return;
        }
      }
    }
  });
  observer.observe(document.head, { childList: true });
  observer.observe(document.body, { childList: true });

  document.addEventListener(
    'click',
    (e) => {
      if (e.isTrusted || !isVisibleControl(e.target)) return;
      const now = Date.now();
      if (now - lastScriptedClick <= SCRIPTED_CLICK_WINDOW_MS) remember('synthetic-click');
      lastScriptedClick = now;
    },
    true,
  );

  const hiddenTabInput = (e: Event) => {
    if (e.isTrusted && document.visibilityState === 'hidden') remember('background-input');
  };
  document.addEventListener('pointerdown', hiddenTabInput, true);
  document.addEventListener('keydown', hiddenTabInput, true);
}
