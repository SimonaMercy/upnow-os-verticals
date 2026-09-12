'use client';

import { AmcCategoriesView } from '@/components/amc/AmcCategoriesView';

export default function AmcCategoriesPage() {
  return <AmcCategoriesView base="/amc" listHref="/rental-provider/dashboard/amc" reportHref="/rental-provider/dashboard/amc/expenses" />;
}
