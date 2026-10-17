'use client';

/**
 * RP → AMC expenses (the operating-expenses report by year).
 *
 * Parity with previous page: renders <AmcExpensesReport> unchanged with the
 * same props; adds OsPage + PageHead only.
 * Duplicate title: the component renders its own "Operating expenses · <year>"
 * h1 and has no prop to hide it, so PageHead is kept minimal (eyebrow + title).
 */
import { AmcExpensesReport } from '@/components/amc/AmcExpensesReport';
import { OsPage, PageHead } from '@/components/os/kit';

export default function AmcExpensesPage() {
  return (
    <OsPage>
      <PageHead eyebrow="Operations" title="AMC expenses" />
      <AmcExpensesReport base="/amc" listHref="/rental-provider/dashboard/amc" detailHrefOf={(id) => `/rental-provider/dashboard/amc/${id}`} />
    </OsPage>
  );
}
