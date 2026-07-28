'use client';

/**
 * Standalone sign-in page.
 *
 * Sign-in normally happens in a popup on the landing page, but that page is not
 * reachable while the site is private (`SITE_PRIVATE=1`) — so staff need a real
 * URL that is always allowlisted. This hosts the very same `AuthModal` (OTP
 * flow, one implementation) on a bare branded backdrop, with no marketplace
 * chrome around it.
 *
 * Closing the modal returns to the marketplace; while the site is private that
 * lands on the holding page instead, which is the intended behaviour.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthModal, type AuthModalMode } from '@/components/upnow/AuthModal';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthModalMode>('signin');

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
      {/* Brand sits behind the modal so the page still reads as UpNow while the
          modal is animating in or if JS is slow. */}
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

      <AuthModal mode={mode} onClose={() => router.push('/')} onModeChange={setMode} />
    </main>
  );
}
