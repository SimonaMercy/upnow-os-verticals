'use client';

/**
 * Rental provider — Breaches (the breach pipeline's own page; cases live on /legal).
 *
 * Parity with previous page: renders <BreachesListView> unchanged with the same
 * props (inside the same max-w-6xl wrapper); adds OsPage + PageHead only.
 * Duplicate title: the component renders its own "Breaches" h1 and has no prop
 * to hide it, so PageHead is kept minimal (eyebrow + title).
 */
import { BreachesListView } from '@/components/legal/BreachesListView';
import { OsPage, PageHead } from '@/components/os/kit';

export default function BreachesPage() {
  return (
    <OsPage>
      <PageHead eyebrow="Operations" title="Breaches" />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <BreachesListView
          base="/legal"
          leaseHrefOf={(leaseId) => `/rental-provider/dashboard/operations/${leaseId}`}
          legalHref={'/rental-provider/dashboard/legal'}
          caseHrefOf={(id) => `/rental-provider/dashboard/legal/${id}`}
          breachHrefOf={(id) => `/rental-provider/dashboard/breaches/${id}`}
        />
      </div>
    </OsPage>
  );
}
