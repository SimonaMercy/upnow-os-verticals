'use client';

// Manager: reuses the landlord edit-contract page. It detects the /manager path
// + ?rp=<landlord> and scopes the customer picker (tenant list/search/create) to
// that landlord via /manager/tenants/*?rp=. The contract load + PATCH save are
// already manager-capable on the backend (resolveContractActor). Gated so only a
// manager granted "Manage Agreements" on this landlord reaches the editable form.
//
// Self-heal for a missing scope: a bookmarked / typed / cross-linked URL without
// ?rp= would otherwise fail ManagerPermissionGate (it can't infer the landlord
// from the path alone) even for a manager who holds the permission. When ?rp= is
// absent we resolve the contract's landlord (GET /contracts/:id → landlord.id,
// which is the rental_providers id the gate keys on) and redirect to the same URL
// carrying it — so the gate and the reused edit page both scope correctly.
import { Suspense, useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import EditContractPage from '@/app/rental-provider/dashboard/contracts/[id]/edit/page';
import { ManagerPermissionGate } from '@/components/manager/ManagerPermissionGate';
import { apiGet } from '@/lib/api';

function Resolver() {
  const params = useParams();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = String(params?.id ?? '');
  const rp = sp.get('rp');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (rp || !id) return;
    let cancelled = false;
    apiGet<{ landlord?: { id?: number | null } }>(`/contracts/${id}`)
      .then((c) => {
        if (cancelled) return;
        const lid = c?.landlord?.id;
        if (lid != null) {
          const next = new URLSearchParams(sp.toString());
          next.set('rp', String(lid));
          router.replace(`${pathname}?${next.toString()}`);
        } else {
          // No resolvable landlord — fall through to the gate, which locks.
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rp, id, sp, pathname, router]);

  // While resolving the missing scope, withhold render to avoid a flash of the
  // lock card before the redirect lands.
  if (!rp && !failed) return null;

  return (
    <ManagerPermissionGate flag="canManageAgreements" label="Manage Agreements">
      <EditContractPage />
    </ManagerPermissionGate>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Resolver />
    </Suspense>
  );
}
