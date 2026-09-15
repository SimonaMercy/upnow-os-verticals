'use client';

/**
 * RP → Customers directory (Claude-Design "Customers" handoff).
 *
 * Active customers only — anyone with a live or upcoming lease (ended tenancies
 * live under the Ended Leases nav). The list is DERIVED client-side from the flat
 * /contracts feed (backend `listForRp`, which now also returns per-lease rent
 * arrears for the Outstanding KPI/column). The shared CustomersDirectory renders
 * the hero / KPIs / Row · Grid cards; this page owns the data + Add-customer flow.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CustomerForm } from '@/components/upnow/CustomerForm';
import { CustomersDirectory } from '@/components/upnow/CustomersDirectory';
import { deriveCustomers, type DirectoryContractRow, type DirectoryCustomer } from '@/lib/customersDirectory';
import { tenantDisplayName } from '@/lib/tenantName';

export default function TenantsPage() {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [customers, setCustomers] = useState<DirectoryCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/contracts', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: DirectoryContractRow[]) => {
        if (Array.isArray(data)) setCustomers(deriveCustomers(data));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <CustomersDirectory
        customers={customers}
        loading={loading}
        onAdd={() => setShowAdd(true)}
        viewHref={(id) => `/rental-provider/dashboard/tenants/${id}`}
        emptySubtitle="Customers appear here once you have a rental agreement."
      />

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAdd(false)}
          role="dialog" aria-modal="true" aria-labelledby="add-customer-title">
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 id="add-customer-title" className="text-lg font-bold text-[#1a1916] mb-3">Add a new customer</h2>
            <CustomerForm
              mode="create"
              submitUrl="/api/contracts/tenants"
              method="POST"
              onCancel={() => setShowAdd(false)}
              onDone={(r) => {
                setShowAdd(false);
                // New customers have no contract yet (so the contract-scoped list/detail
                // won't show them); take the RP straight to the contract wizard, prefilled.
                const label = tenantDisplayName(r);
                if (r.tenantId) router.push(`/rental-provider/dashboard/contracts/new?tenantId=${r.tenantId}${label ? `&tenantName=${encodeURIComponent(label)}` : ''}`);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
