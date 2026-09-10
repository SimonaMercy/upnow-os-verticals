'use client';

/** Manager — one vendor for one managed landlord (canManageVendors, 0275). */
import { Lock, Building2 } from 'lucide-react';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { useParams } from 'next/navigation';
import { VendorDetailView } from '@/components/vendors/VendorDetailView';

export default function ManagerVendorDetailPage() {
  const { spId } = useParams<{ spId: string }>();
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageVendors');
  if (!permsLoading && (needsLandlord || !allowed)) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-12">
          <div className={`w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 ${needsLandlord ? 'bg-[#eef3f1] text-[#2e6f5e]' : 'bg-[#ffedd5] text-[#9a3412]'}`}>
            {needsLandlord ? <Building2 size={20} /> : <Lock size={20} />}
          </div>
          <p className="text-base font-bold text-[#1a1916]">{needsLandlord ? 'Select a landlord' : 'Permission required'}</p>
          <p className="text-sm text-[#6b6860] mt-1">{needsLandlord ? 'Pick which landlord you are working for.' : 'The landlord has not given you access to their vendors.'}</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      {effectiveRp != null && (
        <VendorDetailView spId={Number(spId)} base="/manager/maintenance" amcBase="/manager/amc" rp={effectiveRp}
          listHref={`/dashboard/manager/vendors?rp=${effectiveRp}`} amcHref={`/dashboard/manager/amc?rp=${effectiveRp}`}
          amcDetailHrefOf={(id) => `/dashboard/manager/amc/${id}?rp=${effectiveRp}`}
          requestHrefOf={(id) => `/dashboard/manager/maintenance/${id}?rp=${effectiveRp}`} />
      )}
    </div>
  );
}
