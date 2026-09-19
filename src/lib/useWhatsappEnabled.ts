'use client';

import { useEffect, useState } from 'react';
import { whatsappEnabled } from '@/lib/whatsappApi';

/**
 * False until the backend says WhatsApp is switched on here — see whatsappEnabled().
 * Only a landlord or a team member is ever asked: the shell is shared with customers,
 * vendors and admins, who have no WhatsApp and would only be refused. Pass the role
 * where it is known; pages that exist only for landlords and their team need not.
 */
export function useWhatsappEnabled(role?: string | null): boolean {
  const [on, setOn] = useState(false);
  const asks = role === undefined || role === 'rental_provider' || role === 'manager';
  useEffect(() => {
    if (!asks) return;
    let alive = true;
    void whatsappEnabled().then((v) => { if (alive) setOn(v); });
    return () => { alive = false; };
  }, [asks]);
  return asks && on;
}
