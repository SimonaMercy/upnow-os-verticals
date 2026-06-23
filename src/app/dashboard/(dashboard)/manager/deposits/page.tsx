'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** The manager Deposits page became the portfolio-wide Payments ledger (SCRUM-577).
 *  Kept as a redirect (preserving the ?rp landlord scope) so old bookmarks resolve. */
export default function ManagerDepositsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rp = searchParams.get('rp');

  useEffect(() => {
    router.replace(`/dashboard/manager/payments${rp ? `?rp=${rp}` : ''}`);
  }, [router, rp]);

  return null;
}
