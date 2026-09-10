'use client';

/**
 * Manager — Maintenance Coverage (what the landlord covers, who pays, which
 * provider does it). The landlord keeps this under Settings → Maintenance;
 * managers have no settings page, so it stands alone here. Reuses the RP
 * `MaintenanceCoveragePanel`, scoped to the landlord chosen in the
 * LandlordSwitcher (?rp=) and gated by canManageMaintenance — every write hits
 * the landlord-scoped /manager/maintenance/* mirror, enforced server-side.
 */
import Link from 'next/link';
import { Lock, Building2, ArrowLeft } from 'lucide-react';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { MaintenanceCoveragePanel } from '@/components/dashboard/rp/MaintenanceCoveragePanel';

export default function ManagerMaintenanceCoveragePage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageMaintenance');

  if (!permsLoading && (needsLandlord || !allowed)) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-12">
          <div className={`w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 ${needsLandlord ? 'bg-[#eef3f1] text-[#2e6f5e]' : 'bg-[#ffedd5] text-[#9a3412]'}`}>
            {needsLandlord ? <Building2 size={20} /> : <Lock size={20} />}
          </div>
          <p className="text-base font-bold text-[#1a1916]">{needsLandlord ? 'Select a landlord' : 'Permission required'}</p>
          <p className="text-[13.5px] text-[#9b9890] mt-1.5 leading-relaxed">
            {needsLandlord
              ? 'Maintenance coverage is set per landlord. Choose a landlord from the switcher above.'
              : 'This landlord hasn’t granted you the Manage Maintenance permission.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href={`/dashboard/manager/maintenance-list?rp=${effectiveRp ?? ''}`} className="inline-flex items-center gap-1 text-sm text-[#9b9890] hover:text-[#1a1916] mb-2">
            <ArrowLeft size={15} /> Maintenance List
          </Link>
          <h1 className="text-2xl font-bold text-[#1a1916]">Maintenance Coverage</h1>
          <p className="text-sm text-[#6b6860] max-w-xl">What this landlord covers during a tenancy, who pays, and which provider does the work. Items themselves are managed on the Maintenance List.</p>
        </div>
      </div>
      {effectiveRp != null && <MaintenanceCoveragePanel manager={{ rp: effectiveRp }} />}
    </div>
  );
}
