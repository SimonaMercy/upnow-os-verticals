/**
 * Edge middleware — private-site gate + server-side auth/role gate.
 *
 * TWO independent layers:
 *
 * 1. PRIVATE SITE MODE (`SITE_PRIVATE=1`)
 *    While the platform is not open to the public, anonymous visitors get a
 *    "private beta" holding page instead of the marketplace. Staff sign in at
 *    /login exactly as before; once the session cookie is set this layer is
 *    completely transparent, so day-to-day internal use is unchanged.
 *    Toggle without a rebuild:
 *      gcloud run services update upnow-prod-frontend \
 *        --region me-central1 --set-env-vars SITE_PRIVATE=1
 *
 * 2. DASHBOARD AUTH + ROLE GATE (always on)
 *    The client `DashboardShell` already redirects unauthenticated users, but
 *    that runs only after hydration and never checks role against the route —
 *    so any authenticated user could open `/dashboard/admin/*`. This enforces,
 *    BEFORE the page renders:
 *      a. a session cookie must be present on any dashboard route, else → /login
 *      b. the admin area is restricted to admin / super_admin, else → their home
 *
 * This is defense-in-depth for UX/shell exposure. The backend RolesGuard remains
 * the authoritative gate on the data itself. We read the role from the (already
 * backend-issued, httpOnly) JWT payload for routing only — we do not verify the
 * signature here.
 */
import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = 'upnow_token';

/** Private-site mode — anonymous visitors see the holding page. */
const SITE_PRIVATE = process.env.SITE_PRIVATE === '1';

/**
 * Routes that stay reachable to anonymous visitors while the site is private.
 *
 * `/login` is how staff get in. The rest are links we hand to named outside
 * parties (customers, landlords, invited managers) — closing those would break
 * KYC, lease signing and invitations for people already onboarded.
 */
const PRIVATE_ALLOWLIST = [
  '/login',
  '/coming-soon',
  '/forgot-password',
  '/verify',
  '/verify-email',
  '/invite',
  '/portal',
];

/** Routes that require a session regardless of private mode. */
const DASHBOARD_PREFIXES = ['/dashboard', '/rental-provider/dashboard'];

/** Decode a JWT payload (no signature verification — routing use only). */
function readRole(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
    const claims = JSON.parse(json) as { role?: string };
    return claims.role ?? null;
  } catch {
    return null;
  }
}

/** Landing route per role (mirrors AuthContext.dashboardPath). */
function homeForRole(role: string | null): string {
  switch (role) {
    case 'super_admin':
    case 'admin':
      return '/dashboard/admin';
    case 'rental_provider':
      return '/rental-provider/dashboard';
    case 'service_provider':
      return '/dashboard/service-provider';
    case 'manager':
      return '/dashboard/manager';
    case 'technician':
      return '/dashboard/technician';
    default:
      return '/';
  }
}

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(COOKIE)?.value;

  // ─── Layer 2: dashboard routes always require a session ────────────────────
  if (startsWithAny(pathname, DASHBOARD_PREFIXES)) {
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }

    // Admin area is admin/super_admin only.
    if (pathname.startsWith('/dashboard/admin')) {
      const role = readRole(token);
      if (role !== 'admin' && role !== 'super_admin') {
        const url = req.nextUrl.clone();
        url.pathname = homeForRole(role);
        url.search = '';
        return NextResponse.redirect(url);
      }
    }

    return NextResponse.next();
  }

  // ─── Layer 1: private site — anonymous visitors get the holding page ───────
  if (SITE_PRIVATE && !token && !startsWithAny(pathname, PRIVATE_ALLOWLIST)) {
    const url = req.nextUrl.clone();
    url.pathname = '/coming-soon';
    url.search = '';
    // 503 (not 404) tells crawlers "temporarily unavailable" — the URL keeps
    // its history instead of being permanently de-indexed.
    return NextResponse.rewrite(url, {
      status: 503,
      headers: { 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  const res = NextResponse.next();
  if (SITE_PRIVATE) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export const config = {
  // Everything except the API proxy, uploads, Next internals and static files.
  // `/api/*` MUST stay open or the sign-in POST itself would be blocked.
  matcher: ['/((?!api|_next|uploads|.*\\..*).*)'],
};
