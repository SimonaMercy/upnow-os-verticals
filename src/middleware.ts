/**
 * Edge middleware — server-side auth + role gate for dashboard routes.
 *
 * The client `DashboardShell` already redirects unauthenticated users, but that
 * runs only after hydration and never checks role against the route — so any
 * authenticated user could open `/dashboard/admin/*`. This middleware enforces,
 * BEFORE the page renders:
 *   1. a session cookie must be present on any dashboard route, else → /login
 *   2. the admin area is restricted to admin / super_admin, else → their home
 *
 * This is defense-in-depth for UX/shell exposure. The backend RolesGuard remains
 * the authoritative gate on the data itself. We read the role from the (already
 * backend-issued, httpOnly) JWT payload for routing only — we do not verify the
 * signature here.
 */
import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = 'upnow_token';

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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(COOKIE)?.value;

  // No session → bounce to login, preserving the intended destination.
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

export const config = {
  matcher: ['/dashboard/:path*', '/rental-provider/dashboard/:path*'],
};
