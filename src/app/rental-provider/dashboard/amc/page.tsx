'use client';

import { AmcView } from '@/components/amc/AmcView';

export default function AmcPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <AmcView base="/amc" propertiesUrl="/properties" vendorsHref="/rental-provider/dashboard/vendors" reportHref="/rental-provider/dashboard/amc/expenses" categoriesHref="/rental-provider/dashboard/settings?tab=categories" />
    </div>
  );
}
