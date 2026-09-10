'use client';

/**
 * Manager — Maintenance requests history for one managed landlord (mirrors
 * the RP page through /manager/maintenance/*?rp=, canManageMaintenance).
 */
import { Lock, Building2 } from 'lucide-react';
import { LandlordSwitcher } from '@/components/dashboard/LandlordSwitcher';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { MaintenanceRequestsIndex } from '@/components/upnow/MaintenanceRequestsIndex';

export default function ManagerMaintenanceRequestsPage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageMaintenance');
  if (!permsLoading && (needsLandlord || !allowed)) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-end mb-4"><LandlordSwitcher /></div>
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-12">
          <div className={`w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 ${needsLandlord ? 'bg-[#eef3f1] text-[#2e6f5e]' : 'bg-[#ffedd5] text-[#9a3412]'}`}>
            {needsLandlord ? <Building2 size={20} /> : <Lock size={20} />}
          </div>
          <p className="text-base font-bold text-[#1a1916]">{needsLandlord ? 'Select a landlord' : 'Permission required'}</p>
          <p className="text-[13.5px] text-[#9b9890] mt-1.5 leading-relaxed">
            {needsLandlord ? 'Maintenance is managed per landlord. Choose a landlord from the switcher above.' : 'This landlord hasn’t granted you the Manage Maintenance permission.'}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-end px-4 pt-4 max-w-6xl mx-auto"><LandlordSwitcher /></div>
      {effectiveRp != null && (
        <MaintenanceRequestsIndex
          base="/manager/maintenance" rp={effectiveRp}
          detailHref={(id) => `/dashboard/manager/maintenance/${id}?rp=${effectiveRp}`}
          boardHref={`/dashboard/manager/operations?tab=maintenance&view=kanban&rp=${effectiveRp}`}
        />
      )}
    </div>
  );
}
