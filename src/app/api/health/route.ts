import { NextResponse } from 'next/server';

// Liveness probe for the admin status page (backend `frontend` component).
//
// Deliberately under /api: the middleware matcher excludes `api`, so this is
// the one path that stays 200 regardless of SITE_PRIVATE. Probing `/` instead
// reads the coming-soon holding page, which answers 503 ON PURPOSE — that is
// what made the status page report the frontend as down while it was fine.
//
// A static segment also wins over the `[...path]` catch-all, so this is
// answered here and never proxied to NestJS.
//
// Scope: proves this server is up and routing. It does NOT prove React page
// rendering works, and it must stay cheap — it runs every 5 minutes forever.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'upnow-frontend' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
