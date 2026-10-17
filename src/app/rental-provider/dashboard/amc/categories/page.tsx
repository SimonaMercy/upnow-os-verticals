'use client';

/**
 * RP → AMC categories (Settings).
 *
 * Parity with previous page: renders <AmcCategoriesView> with the same props
 * (base, listHref, reportHref); adds OsPage + PageHead only.
 * Duplicate title: the component accepts `embedded`, which hides its own
 * "Contract categories" h1 and "← AMC Contracts" back button, so it is passed.
 * The back link is kept as a labelled PageHead action, and the part of the old
 * long description that `embedded` drops (switch-off keeps history) is the lede.
 */
import { AmcCategoriesView } from '@/components/amc/AmcCategoriesView';
import { OsPage, PageHead, Btn } from '@/components/os/kit';

export default function AmcCategoriesPage() {
  return (
    <OsPage>
      <PageHead
        eyebrow="Settings"
        title="AMC categories"
        lede="The categories and sub-categories an AMC contract can fall under. Switch one off to keep its history but stop offering it."
        actions={<Btn href="/rental-provider/dashboard/amc">AMC contracts</Btn>}
      />
      <AmcCategoriesView base="/amc" listHref="/rental-provider/dashboard/amc" reportHref="/rental-provider/dashboard/amc/expenses" embedded />
    </OsPage>
  );
}
