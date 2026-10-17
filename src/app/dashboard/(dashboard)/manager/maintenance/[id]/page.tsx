'use client';

/**
 * Manager — one maintenance request (mirrors the RP detail page). Data comes
 * from /manager/maintenance/*?rp=<id>, gated on the per-landlord
 * canManageMaintenance flag; the shared MaintenanceRequestView does the rest.
 */
import { Lock, Building2 } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { MaintenanceRequestView } from '@/components/upnow/MaintenanceRequestView';

export default function ManagerMaintenanceRequestPage() {
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageMaintenance');

  if (!permsLoading && (needsLandlord || !allowed)) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-[18px] px-7 py-10 mt-12">
          <div className={`w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 ${needsLandlord ? 'bg-[#eef3f1] text-[#2e6f5e]' : 'bg-[#ffedd5] text-[#9a3412]'}`}>
            {needsLandlord ? <Building2 size={20} /> : <Lock size={20} />}
          </div>
          <p className="text-base font-bold text-[#14201a]">{needsLandlord ? 'Select a landlord' : 'Permission required'}</p>
          <p className="text-[13.5px] text-[#8a948d] mt-1.5 leading-relaxed">
            {needsLandlord
              ? 'Maintenance is managed per landlord. Choose a landlord from the switcher above.'
              : 'This landlord hasn’t granted you the Manage Maintenance permission.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-2 py-4">
      {effectiveRp != null && (
        <MaintenanceRequestView
          base="/manager/maintenance"
          rp={effectiveRp}
          id={Number(params.id)}
          backHref={`/dashboard/manager/maintenance?rp=${sp.get('rp') ?? effectiveRp}`}
        />
      )}
    </div>
  );
}
