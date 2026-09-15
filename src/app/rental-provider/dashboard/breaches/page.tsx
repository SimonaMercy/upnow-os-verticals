'use client';

/** Rental provider — Breaches (the breach pipeline's own page; cases live on /legal). */
import { BreachesListView } from '@/components/legal/BreachesListView';

export default function BreachesPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <BreachesListView
        base="/legal"
        leaseHrefOf={(leaseId) => `/rental-provider/dashboard/operations/${leaseId}`}
        legalHref={'/rental-provider/dashboard/legal'}
        caseHrefOf={(id) => `/rental-provider/dashboard/legal/${id}`}
      />
    </div>
  );
}
