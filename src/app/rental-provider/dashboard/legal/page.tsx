'use client';

/** Rental provider — Legal (disputes list, spec §7.2). */
import { DisputesListView } from '@/components/legal/DisputesListView';

export default function LegalPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <DisputesListView
        base="/legal"
        detailHrefOf={(id) => `/rental-provider/dashboard/legal/${id}`}
        leaseHrefOf={(leaseId) => `/rental-provider/dashboard/operations/${leaseId}`}
      />
    </div>
  );
}
