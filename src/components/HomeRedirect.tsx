'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, dashboardPath } from '@/contexts/AuthContext';

/**
 * Mounted on the landing page (/). If the authenticated user is not a customer,
 * redirect them straight to their dashboard — they should never see the marketing page.
 */
export function HomeRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    if (user.role !== 'customer') {
      router.replace(dashboardPath(user.role));
    }
  }, [user, loading, router]);

  return null;
}
