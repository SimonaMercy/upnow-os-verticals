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

function apiOrigin(): string {
  const raw =
    process.env.API_INTERNAL_URL ??
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
    return NextResponse.json(
      { error: `Could not reach the API at ${target}: ${(e as Error).message}` },
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
    return NextResponse.json(
      { error: `API returned HTTP ${upstream.status} for ${target}` },
      { status: upstream.status },
    );
  }

  return new NextResponse(await upstream.text(), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
