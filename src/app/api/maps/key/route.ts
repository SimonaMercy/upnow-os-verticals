import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Returns the Maps JS SDK key only to authenticated sessions.
// GOOGLE_MAPS_KEY has no NEXT_PUBLIC_ prefix so it is never bundled into the client.
export async function GET() {
  const store = await cookies();
  if (!store.get('upnow_token')?.value) {
    return NextResponse.json({ key: '' }, { status: 401 });
  }
  return NextResponse.json({ key: process.env.GOOGLE_MAPS_KEY ?? '' });
}
