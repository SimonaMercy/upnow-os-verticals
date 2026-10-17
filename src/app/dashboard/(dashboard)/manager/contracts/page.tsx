'use client';

/**
 * Manager — Leases. Reuses the RP `OrdersWorkspace` (the current lease-centric
 * "Orders" design), scoped to the landlord chosen in the LandlordSwitcher (?rp=)
 * and gated by canManageAgreements. Rows/links point into the manager portal;
 * data comes from the landlord-scoped /manager/contracts endpoints.
 *
 * Previously this was a hand-maintained copy of the OLD Orders design — now it
 * shares the RP component so the two stay in sync automatically.
 */
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { OrdersWorkspace } from '@/app/rental-provider/dashboard/orders/page';

export default function ManagerContractsPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageAgreements)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageAgreements', effectiveRp);

  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#14201a]">Permission required</p>
          <p className="text-sm text-[#5f6b63] mt-1.5 leading-relaxed">
            This landlord hasn&rsquo;t granted you the <strong>Manage Contracts</strong> permission, so their leases aren&rsquo;t available.
          </p>
        </div>
      </div>
    );
  }
  if (permsLoading || effectiveRp == null) {
    return <div className="p-6 text-sm text-[#8a948d]">Loading…</div>;
  }
  return <OrdersWorkspace manager={{ rp: effectiveRp }} />;
}
