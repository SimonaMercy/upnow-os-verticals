'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { CountryItem, EmirateItem } from './_ListingsView';
import { FilterSidebar } from './FilterBar';

interface Props {
  category:    string;
  spaceType:   string;
  bedrooms:    string;
  minPrice:    string;
  maxPrice:    string;
  sort:        string;
  q:           string;
  /** Emirate slug from URL path, e.g. 'dubai' */
  emirate:     string;
  /** Lowercase ISO country code from URL path, e.g. 'ae' */
  country:     string;
  emirateName: string;
  countryName: string;
  /** Full country list passed from server — no client fetch */
  countriesList: CountryItem[];
  /** Full emirate list passed from server — no client fetch */
  emiratesList:  EmirateItem[];
  total:       number;
}

export default function FilterSidebarWrapper(props: Props) {
  const { country, emirate } = props;
  const router = useRouter();
  const sp = useSearchParams();

  function navigate(overrides: Record<string, string>) {
    const nextCountry = 'country' in overrides ? overrides.country : country;
    const nextEmirate = 'emirate' in overrides ? overrides.emirate : emirate;

    let basePath = '/listings';
    if (nextCountry) basePath += `/${nextCountry}`;
    if (nextCountry && nextEmirate) basePath += `/${nextEmirate}`;

    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (k === 'country' || k === 'emirate') continue;
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('country');
    next.delete('emirate');
    next.delete('page');

    const qs = next.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ''}`);
  }

  return <FilterSidebar {...props} onNavigate={navigate} />;
}

