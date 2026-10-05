// Typed fetch wrapper — routes all calls through the Next.js /api proxy.
// JWTs are stored in httpOnly cookies managed server-side by the proxy;
// they never touch JavaScript context (no localStorage, no sessionStorage).
// See: src/app/api/[...path]/route.ts

import { leaveForAiAgent } from "./aiAgentSignals";

// In-flight GET requests keyed by path, so concurrent identical reads share a
// single network request (see apiGet). Cleared the moment each settles.
const inFlightGets = new Map<string, Promise<unknown>>();

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body) {
        if (Array.isArray(body.message)) message = body.message.join(", ");
        else if (typeof body.message === "string") message = body.message;
        else if (typeof body.error === "string") message = body.error;
        // An AI agent was seen driving this tab — the session is gone (the
        // proxy cleared it); off to /login with the reason (lib/aiAgentSignals.ts).
        if (res.status === 403 && body.error === "AI_AGENT_BLOCKED") leaveForAiAgent();
      }
    } catch {
      try {
        message = (await res.text()) || res.statusText;
      } catch {
        // keep statusText
      }
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
  // When a caller manages its own AbortSignal, don't coalesce — it wants an
  // independent request lifecycle (aborting a shared request would cancel it
  // for every other subscriber).
  if (options?.signal) {
    const res = await fetch(`/api${path}`, {
      credentials: "include",
      cache: "no-store",
      signal: options.signal,
    });
    return handleResponse<T>(res);
  }

  // Request coalescing: if an identical GET is already in flight, every caller
  // shares that one network request instead of firing its own. This collapses
  // the "same endpoint requested 3× at the same time" glitch — e.g. /auth/me
  // hit by AuthContext + DashboardShell, or any endpoint double-mounted by
  // React StrictMode — into a single request. The entry is removed as soon as
  // the request settles, so there is no stale caching: a later call re-fetches.
  const existing = inFlightGets.get(path);
  if (existing) return existing as Promise<T>;

  const p = (async () => {
    try {
      const res = await fetch(`/api${path}`, {
        credentials: "include",
        cache: "no-store",
      });
      return await handleResponse<T>(res);
    } finally {
      inFlightGets.delete(path);
    }
  })();
  inFlightGets.set(path, p);
  return p as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handleResponse<T>(res);
}

/** Multipart upload through the proxy — field name "file"; auth via cookies. */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  return handleResponse<T>(res);
}
