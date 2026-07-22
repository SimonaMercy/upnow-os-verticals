'use client';

/**
 * Manager — Restoration List (inspection price book). Reuses the RP
 * `RestorationListWorkspace`, scoped to the landlord chosen in the
 * LandlordSwitcher (?rp=) and gated by canManageInspections. Full edit: price
 * writes hit the landlord-scoped /manager/inspection-price-book endpoints,
 * enforced server-side.
 */
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { RestorationListWorkspace } from '@/app/rental-provider/dashboard/restoration-list/page';

export default function ManagerRestorationListPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageInspections)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageInspections', effectiveRp);

  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            This landlord hasn&rsquo;t granted you the <strong>Manage Inspections</strong> permission, so their Restoration List isn&rsquo;t available.
          </p>
        </div>
      </div>
    );
  }
  if (permsLoading || effectiveRp == null) {
    return <div className="p-6 text-sm text-[#9b9890]">Loading…</div>;
  }
  return <RestorationListWorkspace manager={{ rp: effectiveRp }} />;
}
