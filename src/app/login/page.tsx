'use client';

/**
 * Standalone sign-in page.
 *
 * Sign-in normally happens in a popup on the landing page, but that page is not
 * reachable while the site is private (`SITE_PRIVATE=1`) — so staff need a real
 * URL that is always allowlisted. This hosts the very same `AuthModal` (phone or
 * email → 6-digit OTP, one implementation) on the same animated backdrop as
 * /coming-soon, so the two pages read as one system.
 *
 * Closing the modal returns to the marketplace; while the site is private that
 * lands on the holding page instead, which is the intended behaviour.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Outfit } from 'next/font/google';
import { AuthModal, type AuthModalMode } from '@/components/upnow/AuthModal';
import { SiteBackdrop } from '@/components/upnow/SiteBackdrop';
import styles from './loginPage.module.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const WORDMARK = ['U', 'p', 'N', 'o', 'w'];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthModalMode>('signin');

  return (
    <main className={`${styles.page} ${outfit.className}`}>
      <SiteBackdrop />

      {/* Brand shows through behind the popup, so the page still reads as UpNow
          while the modal is mounting or if JS is slow. */}
      <div className={styles.brand}>
        <div className={styles.orb}>
          <div className={styles.orbGlow} />
          <div className={styles.ring1} />
          <div className={styles.ring2} />
          <span className={styles.mark}>
            U
            <span className={styles.shine} />
          </span>
        </div>

        <span className={styles.wordmark}>
          {WORDMARK.map((letter, i) => (
            <span key={letter} style={{ animationDelay: `${0.45 + i * 0.08}s` }}>
              {letter}
            </span>
          ))}
        </span>
      </div>

      {/* Pinned open: on a dedicated /login URL there is nothing behind the
          popup, so a stray backdrop click or Escape would eject the visitor
          mid-sign-in — and while the site is private, onto the holding page. */}
      <AuthModal
        mode={mode}
        onClose={() => router.push('/')}
        onModeChange={setMode}
        dismissible={false}
      />
    </main>
  );
}
