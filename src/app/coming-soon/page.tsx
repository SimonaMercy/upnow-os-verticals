/**
 * Holding page shown to anonymous visitors while `SITE_PRIVATE=1`.
 *
 * Reached by rewrite from middleware (with a 503), so the visitor keeps the URL
 * they asked for. Deliberately says nothing about the product roadmap and links
 * only to staff sign-in.
 */
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'UpNow — Coming soon',
  robots: { index: false, follow: false },
};

/**
 * Rendered per request so the copyright year is always current — a statically
 * prerendered page would freeze the year at build time until the next deploy.
 */
export const dynamic = 'force-dynamic';

export default function ComingSoonPage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'linear-gradient(160deg, #0e1a16 0%, #12241e 60%, #0e1a16 100%)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460, textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            fontWeight: 800,
            fontSize: 24,
            letterSpacing: '-.02em',
            color: '#fff',
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: 'linear-gradient(135deg, #1f8a6e 0%, #34c79f 100%)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            U
          </span>
          UpNow
        </div>

        <h1
          style={{
            marginTop: 28,
            fontSize: 28,
            lineHeight: 1.25,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '-.02em',
          }}
        >
          Coming soon
        </h1>

        <p style={{ marginTop: 14, fontSize: 15, lineHeight: 1.6, color: '#9fb3ab' }}>
          We&rsquo;ll be back with the best user experience to manage your
          rentals and services &mdash; all in one platform.
        </p>

        <div
          style={{
            marginTop: 32,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Link
            href="/login"
            style={{
              padding: '11px 22px',
              borderRadius: 999,
              background: '#2e9f82',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Log in
          </Link>
        </div>

        <p style={{ marginTop: 40, fontSize: 12, color: '#5f736c' }}>
          &copy; {new Date().getFullYear()} UpNow. All rights reserved.
        </p>
      </div>
    </main>
  );
}
