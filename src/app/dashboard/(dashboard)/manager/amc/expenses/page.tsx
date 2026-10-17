'use client';

/** Manager — the month-end expenses report for one managed landlord (canManageAmc). */
import { Lock, Building2 } from 'lucide-react';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { AmcExpensesReport } from '@/components/amc/AmcExpensesReport';

export default function ManagerAmcExpensesPage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope(['canManageAmc', 'canRecordVendorPayments']);
  if (!permsLoading && (needsLandlord || !allowed)) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-[18px] px-7 py-10 mt-12">
          <div className={`w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 ${needsLandlord ? 'bg-[#eef3f1] text-[#2e6f5e]' : 'bg-[#ffedd5] text-[#9a3412]'}`}>
            {needsLandlord ? <Building2 size={20} /> : <Lock size={20} />}
          </div>
          <p className="text-base font-bold text-[#14201a]">{needsLandlord ? 'Select a landlord' : 'Permission required'}</p>
        </div>
      </div>
    );
  }
  return effectiveRp != null ? (
    <AmcExpensesReport base="/manager/amc" rp={effectiveRp} listHref={`/dashboard/manager/amc?rp=${effectiveRp}`} detailHrefOf={(id) => `/dashboard/manager/amc/${id}?rp=${effectiveRp}`} />
  ) : null;
}
