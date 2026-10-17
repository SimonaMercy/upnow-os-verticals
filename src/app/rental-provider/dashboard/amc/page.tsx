'use client';

/**
 * RP → AMC contracts.
 *
 * Parity with previous page: renders <AmcView> unchanged with the same props
 * (inside the same max-w-5xl wrapper); adds OsPage + PageHead only.
 * Duplicate title: AmcView renders its own "AMC Contracts" h1 and has no prop
 * to hide it, so PageHead is kept minimal (eyebrow + title).
 */
import { AmcView } from '@/components/amc/AmcView';
import { OsPage, PageHead } from '@/components/os/kit';

export default function AmcPage() {
  return (
    <OsPage>
      <PageHead eyebrow="Operations" title="AMC contracts" />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <AmcView base="/amc" propertiesUrl="/properties" vendorsHref="/rental-provider/dashboard/vendors" reportHref="/rental-provider/dashboard/amc/expenses" categoriesHref="/rental-provider/dashboard/settings?tab=categories" />
      </div>
    </OsPage>
  );
}
