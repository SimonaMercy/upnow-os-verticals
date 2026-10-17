'use client';

/**
 * Rental provider — Legal (disputes list, spec §7.2).
 *
 * Parity with previous page: renders <DisputesListView> unchanged with the same
 * props (inside the same max-w-6xl wrapper); adds OsPage + PageHead only.
 * Duplicate title: the component renders its own "Legal" h1 and has no prop to
 * hide it, so PageHead is kept minimal (eyebrow + title).
 */
import { DisputesListView } from '@/components/legal/DisputesListView';
import { OsPage, PageHead } from '@/components/os/kit';

export default function LegalPage() {
  return (
    <OsPage>
      <PageHead eyebrow="Operations" title="Legal cases" />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <DisputesListView
          base="/legal"
          detailHrefOf={(id) => `/rental-provider/dashboard/legal/${id}`}
          leaseHrefOf={(leaseId) => `/rental-provider/dashboard/operations/${leaseId}`}
        />
      </div>
    </OsPage>
  );
}
