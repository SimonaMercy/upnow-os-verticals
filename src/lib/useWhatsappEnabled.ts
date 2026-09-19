'use client';

import { useEffect, useState } from 'react';
import { whatsappEnabled } from '@/lib/whatsappApi';

/** False until the backend says WhatsApp is switched on here — see whatsappEnabled(). */
export function useWhatsappEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void whatsappEnabled().then((v) => { if (alive) setOn(v); });
    return () => { alive = false; };
  }, []);
  return on;
}
