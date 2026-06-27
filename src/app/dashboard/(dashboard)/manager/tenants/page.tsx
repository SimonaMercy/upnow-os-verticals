/**
 * Manager "Customers" page — Claude-Design "Customers" handoff.
 *
 * Mirrors the landlord Customers page (src/app/rental-provider/dashboard/tenants)
 * via the shared CustomersDirectory, but for the landlord selected in the
 * LandlordSwitcher (`?rp=<landlordId>`): permission-gated on `canManageAgreements`
 * and read-only except for Add-customer (gated on `canCreateContracts`). The list
 * is DERIVED from `/manager/contracts?rp=<id>` (same backend `listForRp` shape the
 * RP page consumes), using the shared deriveCustomers logic.
 */
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { CustomerForm } from '@/components/upnow/CustomerForm';
import { CustomersDirectory } from '@/components/upnow/CustomersDirectory';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { deriveCustomers, type DirectoryContractRow, type DirectoryCustomer } from '@/lib/customersDirectory';

export default function ManagerTenantsPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  // Effective landlord = the one chosen in the LandlordSwitcher (`?rp=`), else
  // the first managed landlord that delegated agreement access.
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find((r) => r.permissions.canManageAgreements)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageAgreements', effectiveRp);
  const canCreate = effectiveRp != null && canForRp('canCreateContracts', effectiveRp);
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);

  // Tag the loaded rows with the landlord they belong to. A landlord switch
  // (?rp= changes) re-runs the effect without remounting, so deriving `loading`
  // from "do the loaded rows match the current landlord?" lets us show the
  // loading state on switch — instead of flashing the prior landlord's rows —
  // without a synchronous setState in the effect (react-hooks/set-state-in-effect).
  const [loaded, setLoaded] = useState<{ rp: number; rows: DirectoryCustomer[] } | null>(null);

  useEffect(() => {
    if (effectiveRp == null || !allowed) return;
    let cancelled = false;
    apiGet<DirectoryContractRow[]>(`/manager/contracts?rp=${effectiveRp}`)
      .then((data) => { if (!cancelled) setLoaded({ rp: effectiveRp, rows: Array.isArray(data) ? deriveCustomers(data) : [] }); })
      .catch(() => { if (!cancelled) setLoaded({ rp: effectiveRp, rows: [] }); });
    return () => { cancelled = true; };
  }, [effectiveRp, allowed]);

  const customers = loaded?.rp === effectiveRp ? loaded.rows : [];
  const loading = permsLoading || (allowed && loaded?.rp !== effectiveRp);

  // Per-landlord permission gate — mirrors the lock the manager contracts page uses.
  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            This landlord hasn’t granted you the <strong>Manage Agreements</strong> permission, so their customers aren’t available.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <CustomersDirectory
        customers={customers}
        loading={loading}
        onAdd={canCreate ? () => setShowAdd(true) : undefined}
        viewHref={(id) => `/dashboard/manager/tenants/${id}?rp=${effectiveRp}`}
        emptySubtitle="Customers appear here once this landlord has a rental agreement."
      />

      {showAdd && effectiveRp != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAdd(false)}
          role="dialog" aria-modal="true" aria-labelledby="add-customer-title">
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 id="add-customer-title" className="text-lg font-bold text-[#1a1916] mb-3">Add a new customer</h2>
            <CustomerForm
              mode="create"
              method="POST"
              submitUrl={`/api/manager/tenants?rp=${effectiveRp}`}
              onCancel={() => setShowAdd(false)}
              onDone={(r) => {
                setShowAdd(false);
                if (r.tenantId) router.push(`/dashboard/manager/contracts/new?rp=${effectiveRp}&tenantId=${r.tenantId}${r.name ? `&tenantName=${encodeURIComponent(r.name)}` : ''}`);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
