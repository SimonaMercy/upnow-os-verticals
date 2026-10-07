'use client';

/**
 * Manager — Building inspections gate (0383). Scoped to the landlord chosen in the
 * LandlordSwitcher (?rp=) and gated by canManageInspections; every call carries ?rp=.
 */
import { Lock } from 'lucide-react';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';

export function ManagerBuildingInspectionsGate({ children }: { children: (rp: number) => React.ReactNode }) {
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageInspections');
  if (permsLoading) return <div className="p-6 text-sm text-[#9b9890]">Loading…</div>;
  if (needsLandlord) return <SelectLandlordNotice resource="Building inspections" />;
  if (!allowed || effectiveRp == null) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]"><Lock size={20} /></div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">This landlord hasn&rsquo;t granted you the <strong>Manage Inspections</strong> permission, so their building inspections aren&rsquo;t available.</p>
        </div>
      </div>
    );
  }
  return <>{children(effectiveRp)}</>;
}
