// Typed fetch wrapper — routes all calls through the Next.js /api proxy.
// JWTs are stored in httpOnly cookies managed server-side by the proxy;
// they never touch JavaScript context (no localStorage, no sessionStorage).
// See: src/app/api/[...path]/route.ts

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body) {
        if (Array.isArray(body.message)) message = body.message.join(", ");
        else if (typeof body.message === "string") message = body.message;
        else if (typeof body.error === "string") message = body.error;
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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    cache: "no-store",
  });
  return handleResponse<T>(res);
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

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handleResponse<T>(res);
}
