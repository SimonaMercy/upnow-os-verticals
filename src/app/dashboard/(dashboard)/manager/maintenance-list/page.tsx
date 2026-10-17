'use client';

/**
 * Manager — Maintenance List (the landlord's coverage vocabulary). Reuses the
 * RP `MaintenanceListWorkspace`, scoped to the landlord chosen in the
 * LandlordSwitcher (?rp=) and gated by canManageMaintenance. Full edit: every
 * write hits the landlord-scoped /manager/maintenance/* mirror, enforced
 * server-side. Same shape as the manager Restoration List page.
 */
import { Lock } from 'lucide-react';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';
import { MaintenanceListWorkspace } from '@/app/rental-provider/dashboard/maintenance-list/page';

export default function ManagerMaintenanceListPage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageMaintenance');

  if (permsLoading) {
    return <div className="p-6 text-sm text-[#8a948d]">Loading…</div>;
  }
  if (needsLandlord) {
    return <SelectLandlordNotice resource="the Maintenance List" />;
  }
  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#14201a]">Permission required</p>
          <p className="text-sm text-[#5f6b63] mt-1.5 leading-relaxed">
            This landlord hasn&rsquo;t granted you the <strong>Manage Maintenance</strong> permission, so their Maintenance List isn&rsquo;t available.
          </p>
        </div>
      </div>
    );
  }
  return <MaintenanceListWorkspace manager={{ rp: effectiveRp! }} />;
}
