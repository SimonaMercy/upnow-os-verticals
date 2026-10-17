'use client';

/**
 * Manager — AMC & Vendor Management (mirrors the RP AMC portal).
 * Data is fetched for the landlord chosen in the LandlordSwitcher via
 * /manager/amc/*?rp=<id>. Opens on canManageAmc (contracts & visits) OR
 * canRecordVendorPayments (bills, installments, expenses report — 0319); the
 * contract-editing actions show only with canManageAmc.
 */
import { Lock, Building2 } from 'lucide-react';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { AmcView } from '@/components/amc/AmcView';

export default function ManagerAmcPage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord, canForRp } = useManagerLandlordScope(['canManageAmc', 'canRecordVendorPayments']);
  const canEdit = effectiveRp != null && canForRp('canManageAmc', effectiveRp);

  // "Select a landlord" and "Permission required" both keep the switcher visible
  // so the manager can change scope from here (AMC renders its own switcher, not
  // the layout's spot).
  if (!permsLoading && (needsLandlord || !allowed)) {
    return (
      <div className="p-6">
        {needsLandlord ? (
          <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-[18px] px-7 py-10 mt-12">
            <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#eef3f1] text-[#2e6f5e]"><Building2 size={20} /></div>
            <p className="text-base font-bold text-[#14201a]">Select a landlord</p>
            <p className="text-[13.5px] text-[#8a948d] mt-1.5 leading-relaxed">
              AMCs are managed per landlord. Choose a landlord from the switcher above to view them.
            </p>
          </div>
        ) : (
          <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-[18px] px-7 py-10 mt-12">
            <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]"><Lock size={20} /></div>
            <p className="text-base font-bold text-[#14201a]">Permission required</p>
            <p className="text-[13.5px] text-[#8a948d] mt-1.5 leading-relaxed">
              This landlord hasn’t granted you the <strong>Handle AMC contracts</strong> or <strong>Record vendor payments</strong> permission, so their AMCs aren’t available.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {effectiveRp != null && <AmcView base="/manager/amc" rp={effectiveRp} canEdit={canEdit} propertiesUrl="/manager/properties" reportHref={`/dashboard/manager/amc/expenses?rp=${effectiveRp}`} categoriesHref={`/dashboard/manager/settings?tab=categories&rp=${effectiveRp}`} />}
    </div>
  );
}
