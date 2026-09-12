'use client';

import { AmcExpensesReport } from '@/components/amc/AmcExpensesReport';

export default function AmcExpensesPage() {
  return (
    <AmcExpensesReport base="/amc" listHref="/rental-provider/dashboard/amc" detailHrefOf={(id) => `/rental-provider/dashboard/amc/${id}`} />
  );
}
