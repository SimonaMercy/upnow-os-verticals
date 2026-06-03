'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FilterSidebar } from './FilterBar';
import type { FilterBarProps } from './FilterBar';

export default function FilterSidebarWrapper(props: FilterBarProps) {
  const { country, emirate } = props;
  const router = useRouter();
  const sp     = useSearchParams();

  function navigate(overrides: Record<string, string>) {
    const nextCountry = 'country' in overrides ? overrides.country : country;
    const nextEmirate = 'emirate' in overrides ? overrides.emirate : emirate;

    let base = '/listings';
    if (nextCountry) base += `/${nextCountry}`;
    if (nextCountry && nextEmirate) base += `/${nextEmirate}`;

    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (k === 'country' || k === 'emirate') continue;
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('country');
    next.delete('emirate');
    next.delete('page');

    router.push(`${base}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  }

  return <FilterSidebar {...props} onNavigate={navigate} />;
}
