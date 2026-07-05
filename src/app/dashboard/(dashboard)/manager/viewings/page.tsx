'use client';

/**
 * Legacy alias — the manager "Leads" workspace now lives at /dashboard/manager/leads
 * (mirroring the RP /leads route). Redirect here, preserving the ?rp= scope.
 */
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ManagerViewingsRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const rp = params.get('rp');
    router.replace(`/dashboard/manager/leads${rp ? `?rp=${rp}` : ''}`);
  }, [router, params]);
  return <div className="p-6 text-sm text-[#9b9890]">Redirecting to Leads…</div>;
}
