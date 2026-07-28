'use client';

/**
 * "Existing customer? Log in" on the holding page.
 *
 * Opens the same AuthModal popup in place — exactly how the landing page opens
 * it over the marketplace — rather than navigating to /login. Closing returns
 * to the holding page, so a stray click costs nothing.
 *
 * /login still exists as a real URL: middleware redirects there when a session
 * expires, and it is the address staff can be given directly.
 */

import { useState } from 'react';
import { AuthModal, type AuthModalMode } from '@/components/upnow/AuthModal';

export function LoginPopupLink({ className }: { className?: string }) {
  const [mode, setMode] = useState<AuthModalMode | null>(null);

  return (
    <>
      <button type="button" className={className} onClick={() => setMode('signin')}>
        Existing customer? Log in
      </button>

      {mode && (
        <AuthModal mode={mode} onClose={() => setMode(null)} onModeChange={setMode} />
      )}
    </>
  );
}
