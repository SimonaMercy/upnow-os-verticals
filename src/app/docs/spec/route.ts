import { NextResponse, type NextRequest } from 'next/server';

/**
 * Same-origin proxy for the OpenAPI spec.
 *
 * `/docs*` on the backend is behind HTTP Basic auth (`docsBasicAuth`), and a
 * browser `fetch` cannot answer that challenge on its own — it never shows the
 * native credentials dialog, and sending an `Authorization` header straight to
 * the API origin would need a preflight that the same middleware rejects
 * (an OPTIONS request carries no credentials). So the viewer asks the user for
 * the credentials itself and posts them here.
 *
 * This route only FORWARDS them: the backend remains the sole validator, and
 * the frontend never holds `DOCS_BASIC_AUTH_USER`/`PASS`. A caller with no
 * credentials gets the backend's own 401 back, challenge header included.
 */
export const dynamic = 'force-dynamic';

/**
 * Backend root, no `/api`.
 *
 * `BACKEND_URL` first, matching every other server-side caller in the app
 * (`app/api/[...path]`, the listings pages, `next.config.ts`). It is the only
 * variable that names the backend itself: `NEXT_PUBLIC_API_URL` is the address
 * the BROWSER uses, which in production is the public host — stripping `/api`
 * off it yields the frontend's own origin, and only `/api/*` is routed through
 * to Nest, so `/docs-json` there never reaches the backend at all.
 */
function apiOrigin(): string {
  const raw =
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3001/api';
  return raw.replace(/\/api\/?$/, '');
}

export async function GET(req: NextRequest) {
  const target = `${apiOrigin()}/docs-json`;
  const auth = req.headers.get('authorization');

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: auth ? { authorization: auth } : {},
      cache: 'no-store',
    });
  } catch (e) {
    // The upstream URL stays out of the response: it names an internal host the
    // browser has no business learning. It goes to the server log instead.
    console.error(`[docs/spec] could not reach ${target}:`, (e as Error).message);
    return NextResponse.json(
      { message: 'The API is not reachable from the server right now.' },
      { status: 502 },
    );
  }

  if (upstream.status === 401) {
    // Relayed verbatim so the viewer can tell "wrong password" apart from
    // "backend is down" and re-prompt instead of showing a dead error screen.
    return new NextResponse('Authentication required.', {
      status: 401,
      headers: {
        'www-authenticate':
          upstream.headers.get('www-authenticate') ?? 'Basic realm="UpNow API Docs"',
      },
    });
  }

  if (!upstream.ok) {
    console.error(`[docs/spec] ${target} returned HTTP ${upstream.status}`);
    // 503 is the documented fail-closed answer when the backend has no
    // DOCS_BASIC_AUTH_USER/PASS configured — worth saying plainly, since it is
    // a deployment setting rather than anything the reader can fix.
    const message =
      upstream.status === 503
        ? 'API documentation is not enabled on this environment (the API has no docs credentials configured).'
        : `The API returned HTTP ${upstream.status} for the spec.`;
    return NextResponse.json({ message }, { status: upstream.status });
  }

  return new NextResponse(await upstream.text(), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
