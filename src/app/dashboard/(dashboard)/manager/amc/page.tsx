'use client';

/**
 * Manager — AMC & Vendor Management (mirrors the RP AMC portal).
 * Data is fetched for the landlord chosen in the LandlordSwitcher via
 * /manager/amc/*?rp=<id>, gated on the per-landlord canManageMaintenance flag.
 */
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { LandlordSwitcher } from '@/components/dashboard/LandlordSwitcher';
import { AmcView } from '@/components/amc/AmcView';

export default function ManagerAmcPage() {
  const { canForRp, rps, loading } = useManagerPermissions();
  const selectedRp = useSearchParams().get('rp');
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageMaintenance)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageMaintenance', effectiveRp);

  if (!loading && !allowed) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-end mb-4"><LandlordSwitcher /></div>
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]"><Lock size={20} /></div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-[13.5px] text-[#9b9890] mt-1.5 leading-relaxed">
            This landlord hasn’t granted you the <strong>Manage Maintenance</strong> permission, so their AMCs aren’t available.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-end mb-4"><LandlordSwitcher /></div>
      {effectiveRp != null && <AmcView base="/manager/amc" rp={effectiveRp} propertiesUrl="/manager/properties" />}
    </div>
  );
}
