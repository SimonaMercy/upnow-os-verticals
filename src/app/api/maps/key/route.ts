import { NextResponse } from 'next/server';

// Returns the Maps JS SDK key. PUBLIC — the booking flow shows the address
// map before sign-in. Browser Maps keys are visible in requests by design;
// the real protection is the HTTP-referrer restriction on the key in GCP.
// GOOGLE_MAPS_KEY has no NEXT_PUBLIC_ prefix so it is never bundled.
export async function GET() {
  return NextResponse.json({ key: process.env.GOOGLE_MAPS_KEY ?? '' });
}
