import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js API catch-all proxy → NestJS backend.
 *
 * Security model (AGENTS.md: "Don't store JWTs in localStorage — use httpOnly
 * cookies via route handlers"):
 *
 * • On login / register / OTP-verify the NestJS backend returns an
 *   `access_token` in the JSON body.  This proxy intercepts it, stores it
 *   in an httpOnly Secure cookie, and strips it from the client-visible
 *   payload so the raw token NEVER reaches JavaScript context.
 *
 * • Every subsequent request reads the cookie server-side and attaches
 *   `Authorization: Bearer …` before forwarding to NestJS.
 *
 * • Logout clears the cookie without a backend call (stateless JWTs expire
 *   naturally at 7 days; full token-revocation via the tokens module is a
 *   later Sprint 1 task).
 */

const BACKEND =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

const COOKIE = 'upnow_token';
const TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days — matches JWT_EXPIRES_IN in backend .env

/** Paths whose successful response body contains a fresh `access_token`. */
const TOKEN_ISSUING_PATHS = new Set([
  '/auth/login',
  '/auth/login/verify-otp',
  '/auth/register/customer',
  '/auth/register/rental-provider',
  '/auth/register/service-provider',
  '/auth/otp/verify',
  '/auth/email/verify-otp',
  '/auth/google',
  '/auth/apple',
]);

/** Dynamic token-issuing path pattern: /invitations/:token/accept */
function isTokenIssuingPath(pathStr: string): boolean {
  if (TOKEN_ISSUING_PATHS.has(pathStr)) return true;
  return /^\/invitations\/[^/]+\/accept$/.test(pathStr);
}

/**
 * Signer-evidence forwarding: this proxy sits between every browser and the
 * backend, so without these headers the API would record the Next server as
 * the "signer". x-forwarded-for carries the browser's IP chain (Next/Amplify
 * populate it; client first) and x-client-user-agent carries the browser's
 * user-agent (fetch() would otherwise overwrite user-agent with its own).
 */
function evidenceHeaders(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const xff = req.headers.get('x-forwarded-for');
  if (xff) out['X-Forwarded-For'] = xff;
  const ua = req.headers.get('user-agent');
  if (ua) out['X-Client-User-Agent'] = ua;
  return out;
}

async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const pathStr = '/' + path.join('/');

  // ── Logout ──────────────────────────────────────────────────────────────
  // Stateless JWTs self-expire; clearing the cookie is sufficient for logout.
  if (pathStr === '/auth/logout' && req.method === 'POST') {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(COOKIE);
    return res;
  }

  // ── Build upstream headers ───────────────────────────────────────────────
  const token = req.cookies.get(COOKIE)?.value;

  // ── Forward query-string params (e.g. /auth/email/confirm?token=…) ───────
  const backendUrl = new URL(`${BACKEND}${pathStr}`);
  req.nextUrl.searchParams.forEach((v, k) => backendUrl.searchParams.set(k, v));

  // ── Binary passthrough for local-dev file uploads ─────────────────────
  // The _upload path receives raw binary PUT requests (image/pdf etc.).
  // Forward the body as-is without JSON encoding.
  if (pathStr.startsWith('/documents/_upload/')) {
    const bodyBuf = await req.arrayBuffer();
    const contentType = req.headers.get('content-type') ?? 'application/octet-stream';
    const fwdHeaders: Record<string, string> = { 'Content-Type': contentType, ...evidenceHeaders(req) };
    if (token) fwdHeaders['Authorization'] = `Bearer ${token}`;
    let upstream: Response;
    try {
      upstream = await fetch(backendUrl.toString(), {
        method: req.method,
        headers: fwdHeaders,
        body: bodyBuf,
      });
    } catch {
      return NextResponse.json({ message: 'Backend unavailable' }, { status: 503 });
    }
    return new NextResponse(null, { status: upstream.ok ? 200 : upstream.status });
  }

  // ── Multipart passthrough for file uploads (e.g. unit media) ────────────
  // Forward multipart/form-data as-is so multer on the backend can parse it.
  const contentTypeHeader = req.headers.get('content-type') ?? '';
  if (contentTypeHeader.startsWith('multipart/form-data')) {
    const bodyBuf = await req.arrayBuffer();
    const fwdHeaders: Record<string, string> = { 'Content-Type': contentTypeHeader, ...evidenceHeaders(req) };
    if (token) fwdHeaders['Authorization'] = `Bearer ${token}`;
    let upstream: Response;
    try {
      upstream = await fetch(backendUrl.toString(), {
        method: req.method,
        headers: fwdHeaders,
        body: bodyBuf,
      });
    } catch {
      return NextResponse.json({ message: 'Backend unavailable' }, { status: 503 });
    }
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    const text = await upstream.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return NextResponse.json(parsed, { status: upstream.status });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...evidenceHeaders(req) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // ── Forward body for mutating methods ────────────────────────────────────
  let bodyText: string | undefined;
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    bodyText = await req.text();
    if (bodyText === '') bodyText = undefined;
  }

  // ── Call NestJS backend ──────────────────────────────────────────────────
  let upstream: Response;
  try {
    upstream = await fetch(backendUrl.toString(), {
      method: req.method,
      headers,
      body: bodyText,
    });
  } catch {
    return NextResponse.json({ message: 'Backend unavailable' }, { status: 503 });
  }

  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  // ── Binary passthrough (e.g. /documents/:id/file) ────────────────────────
  // Anything that isn't JSON or text must stream through UNTOUCHED — decoding
  // file bytes as text (below) irreversibly corrupts PDFs/images.
  const upstreamType = upstream.headers.get('content-type') ?? '';
  if (upstreamType && !upstreamType.includes('json') && !upstreamType.startsWith('text/')) {
    const binHeaders = new Headers({ 'Content-Type': upstreamType });
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) binHeaders.set('Content-Disposition', disposition);
    return new NextResponse(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: binHeaders,
    });
  }

  const rawText = await upstream.text();
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return new NextResponse(rawText, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // ── Intercept access_token on token-issuing routes ───────────────────────
  const issuesToken = isTokenIssuingPath(pathStr);
  const rawToken =
    issuesToken && upstream.ok && data && typeof data === 'object'
      ? ((data as Record<string, unknown>).access_token as string | undefined)
      : undefined;

  // Strip access_token from the client-visible payload.
  const payload =
    rawToken && data && typeof data === 'object'
      ? Object.fromEntries(
          Object.entries(data as Record<string, unknown>).filter(
            ([k]) => k !== 'access_token',
          ),
        )
      : data;

  const response = NextResponse.json(payload, { status: upstream.status });

  if (rawToken) {
    response.cookies.set(COOKIE, rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: TOKEN_TTL,
      path: '/',
    });
  }

  return response;
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
};
