import { NextResponse, type NextRequest } from 'next/server';

/**
 * Same-origin proxy for the backend's OpenAPI spec.
 *
 * The docs viewer used to fetch the spec straight from
 * `${NEXT_PUBLIC_API_URL}/docs-json` in the browser. That was wrong three
 * times over:
 *
 *  1. It printed the backend origin (in prod, a bare IP) into the page and
 *     into the client bundle, where anyone could read it.
 *  2. The origin is `http://`, so an `https://` page could not fetch it at
 *     all — the browser blocked it as mixed content ("Failed to fetch").
 *  3. Nest serves Swagger OUTSIDE the `/api` prefix, and only `/api/*` is
 *     routed to the backend — so `/docs-json` on the public host lands on
 *     this frontend, never on Nest.
 *
 * Fetching server-side fixes all three: the browser only ever talks to its
 * own origin over https, and the upstream host stays inside the container.
 *
 * The spec describes the whole private API, so this requires a session —
 * `SITE_PRIVATE` already gates it, but that is a runtime toggle and this
 * endpoint must not fall open the moment it is switched off.
 */

const COOKIE = 'upnow_token';

/** Backend root (no `/api`) — resolved server-side, never sent to the client. */
function backendRoot(): string {
  const base =
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3001/api';
  return base.replace(/\/api\/?$/, '');
}

/** `/docs*` on the backend sits behind HTTP Basic auth (docs-basic-auth.ts). */
function docsAuthHeader(): Record<string, string> {
  const user = process.env.DOCS_BASIC_AUTH_USER;
  const pass = process.env.DOCS_BASIC_AUTH_PASS;
  if (!user || !pass) return {};
  const encoded = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

export async function GET(req: NextRequest) {
  if (!req.cookies.get(COOKIE)?.value) {
    return NextResponse.json(
      { message: 'Sign in to view the API documentation.' },
      { status: 401 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${backendRoot()}/docs-json`, {
      headers: { Accept: 'application/json', ...docsAuthHeader() },
      cache: 'no-store',
    });
  } catch {
    // Deliberately vague: the upstream URL is exactly what must not leak.
    return NextResponse.json(
      { message: 'The API service is unreachable.' },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const detail =
      upstream.status === 503
        ? 'API documentation is not enabled on this environment.'
        : upstream.status === 401
          ? 'The docs credentials for the API service are missing or wrong.'
          : `The API service returned ${upstream.status}.`;
    return NextResponse.json({ message: detail }, { status: upstream.status });
  }

  return new NextResponse(await upstream.text(), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
