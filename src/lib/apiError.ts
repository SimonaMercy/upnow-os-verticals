/**
 * Read the API's own error message off a failed response.
 *
 * Nest returns `{ statusCode, message }`, and for a validation failure that
 * message is the whole point — "Select a move-out reason" tells the user what
 * to do, where the usual `Request failed: 400` tells them nothing. Falls back
 * to the caller's wording when the body isn't a Nest error (a proxy 502, an
 * HTML error page, a network abort mid-read).
 */
export async function errMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    const m = (body as { message?: unknown })?.message;
    if (typeof m === 'string' && m.trim()) return m;
    if (Array.isArray(m) && m.length && typeof m[0] === 'string') return m.join(', ');
  } catch {
    /* not JSON — fall through */
  }
  return `${fallback}: ${res.status}`;
}
