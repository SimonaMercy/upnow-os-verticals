/**
 * App-wide request coalescing for the API proxy.
 *
 * Many components fetch the same `/api/*` endpoint at the same moment — e.g.
 * `/auth/me` from AuthContext + DashboardShell, a contract from a page + a child
 * panel, or any effect double-invoked by React StrictMode in dev. Roughly 180
 * call sites use raw `fetch('/api/...')` and bypass the coalescing built into
 * `apiGet`, so duplicates still hit the network.
 *
 * This patches `window.fetch` ONCE (client only) so that concurrent, identical
 * GET requests to `/api/*` share a single in-flight network request. Each
 * subscriber receives an independent `Response.clone()`.
 *
 * Safety / scope:
 *  - GET only, `/api/*` only — never touches mutations or other origins/routes.
 *  - Skipped when the caller passes an AbortSignal (it wants its own lifecycle).
 *  - Coalesces ONLY while a request is in flight; the entry is removed the moment
 *    it settles. There is NO time-based cache, so it never serves stale data and
 *    does not break polling or post-mutation refetches.
 */
let installed = false;

export function installApiFetchCoalescing(): void {
  if (installed) return;
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;

  const orig = window.fetch.bind(window);
  const inFlight = new Map<string, Promise<Response>>();

  const coalescedFetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let url = '';
    let method = 'GET';
    let hasSignal = false;

    try {
      if (typeof input === 'string') url = input;
      else if (input instanceof URL) url = input.toString();
      else {
        url = input.url;
        method = input.method || 'GET';
        hasSignal = !!input.signal;
      }
      if (init?.method) method = init.method;
      if (init?.signal) hasSignal = true;
    } catch {
      return orig(input as RequestInfo | URL, init);
    }

    const isApiGet =
      method.toUpperCase() === 'GET' &&
      !hasSignal &&
      (url.startsWith('/api/') || url.includes(`${window.location.origin}/api/`));

    if (!isApiGet) return orig(input as RequestInfo | URL, init);

    const existing = inFlight.get(url);
    if (existing) return existing.then((r) => r.clone());

    const p = orig(input as RequestInfo | URL, init).finally(() => {
      inFlight.delete(url);
    });
    inFlight.set(url, p);
    // The shared Response is never read directly — every subscriber (including
    // the first) reads an independent clone.
    return p.then((r) => r.clone());
  };

  window.fetch = coalescedFetch as typeof window.fetch;
}
