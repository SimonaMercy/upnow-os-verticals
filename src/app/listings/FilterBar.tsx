'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { Search, ChevronDown, LayoutGrid, Rows3, SlidersHorizontal, X, Check, MapPin, Home, Building2, Factory, Mountain } from 'lucide-react';
import { NEW_SPACE_CATEGORIES, categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import { useBackClose } from '@/lib/useSlideOver';

/* ── Sub-category data ────────────────────────────────────────── */
const SPACE_TYPES: Record<string, { label: string; value: string }[]> = {
  residential: [
    { label: 'Apartment',       value: 'apartment' },
    { label: 'Villa',           value: 'villa' },
    { label: 'Townhouse',       value: 'townhouse' },
    { label: 'Studio',          value: 'studio' },
    { label: 'Penthouse',       value: 'penthouse' },
    { label: 'Duplex / Loft',   value: 'duplex_loft' },
  ],
  commercial: [
    { label: 'Retail Shop',           value: 'retail_shop' },
    { label: 'Showroom',              value: 'showroom' },
    { label: 'Fitted Office',         value: 'office_fitted' },
    { label: 'Shell & Core Office',   value: 'office_shell_core' },
    { label: 'Restaurant / F&B',      value: 'restaurant_fnb' },
    { label: 'Clinic / Medical',      value: 'clinic_medical' },
  ],
  industrial: [
    { label: 'Warehouse',          value: 'warehouse' },
    { label: 'Open Yard',          value: 'open_yard' },
    { label: 'Storage Unit',       value: 'storage_unit' },
    { label: 'Cold Storage',       value: 'cold_storage' },
    { label: 'Logistics Facility', value: 'logistics_facility' },
  ],
  // Mixed-use buildings hold both — offer residential + commercial sub-types so a
  // browser can narrow to either; the residential facets below then follow the pick.
  mixed_use: [
    { label: 'Apartment',     value: 'apartment' },
    { label: 'Villa',         value: 'villa' },
    { label: 'Townhouse',     value: 'townhouse' },
    { label: 'Studio',        value: 'studio' },
    { label: 'Penthouse',     value: 'penthouse' },
    { label: 'Duplex / Loft', value: 'duplex_loft' },
    { label: 'Retail Shop',         value: 'retail_shop' },
    { label: 'Showroom',            value: 'showroom' },
    { label: 'Fitted Office',       value: 'office_fitted' },
    { label: 'Shell & Core Office', value: 'office_shell_core' },
    { label: 'Restaurant / F&B',    value: 'restaurant_fnb' },
    { label: 'Clinic / Medical',    value: 'clinic_medical' },
  ],
};

const CATEGORIES = [
  { label: 'All Spaces', value: '' },
  ...NEW_SPACE_CATEGORIES.map(c => ({ label: c.label, value: c.id })),
];

const BEDROOM_OPTIONS = [
  { label: 'Studio', value: '0' },
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5+', value: '5' },
];

const BATH_OPTIONS = [
  { label: '1',  value: '1' },
  { label: '2',  value: '2' },
  { label: '3',  value: '3' },
  { label: '4+', value: '4' },
];

const FURNISHING_OPTIONS = [
  { label: 'Furnished',      value: 'furnished' },
  { label: 'Semi-furnished', value: 'semi' },
  { label: 'Unfurnished',    value: 'unfurnished' },
];

const AMENITIES: Record<string, { label: string; value: string }[]> = {
  residential: [
    { value: 'parking',  label: 'Covered Parking' },
    { value: 'balcony',  label: 'Balcony' },
    { value: 'pool',     label: 'Shared Pool' },
    { value: 'gym',      label: 'Gym' },
    { value: 'security', label: '24/7 Security' },
    { value: 'pets',     label: 'Pets Allowed' },
  ],
  commercial: [
    { value: 'parking',   label: 'Parking' },
    { value: 'pantry',    label: 'Pantry' },
    { value: 'ac',        label: 'Central A/C' },
    { value: 'access',    label: '24/7 Access' },
    { value: 'reception', label: 'Reception' },
    { value: 'metro',     label: 'Near Metro' },
  ],
  industrial: [
    { value: 'loading',   label: 'Loading Bays' },
    { value: 'power',     label: '3-Phase Power' },
    { value: 'ceiling',   label: 'High Ceiling' },
    { value: 'mezzanine', label: 'Mezzanine' },
    { value: 'temp',      label: 'Temp Control' },
    { value: 'yard',      label: 'Yard Space' },
  ],
};

const AVAILABILITY_OPTIONS = [
  { label: 'Ready to move', value: 'ready' },
  { label: 'Off-plan',      value: 'offplan' },
];

const PRICE_MAX: Record<string, number> = {
  residential: 300_000,
  commercial:  1_000_000,
  industrial:  2_000_000,
  '':          2_000_000,
};
const PRICE_STEP = 5_000;

/* ── Helpers ──────────────────────────────────────────────────── */
function fmtK(n: number, max: number) {
  if (n >= max) return 'Any';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/* ── Props ────────────────────────────────────────────────────── */
export interface FilterBarProps {
  category:     string;
  spaceType:    string;
  bedrooms:     string;
  bathrooms:    string;
  furnishing:   string;
  amenities:    string;
  availability: string;
  minPrice:     string;
  maxPrice:     string;
  sort:         string;
  view:         string;
  q:            string;
  emirate:      string;
  country:      string;
  emirateName:  string;
  countryName:  string;
  countriesList: { id: number; code: string; nameEn: string }[];
  emiratesList:  { id: number; nameEn: string; slug: string }[];
  total:        number;
}

/* ── CheckIcon SVG ─────────────────────────────────────────────── */
function CheckSVG() {
  return (
    <svg viewBox="0 0 12 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 5l3.5 4L11 1" />
    </svg>
  );
}

/* ── Dual price slider ─────────────────────────────────────────── */
function PriceRangeSlider({ rangeMax, low, high, onChange }: {
  rangeMax: number; low: number; high: number;
  onChange: (low: number, high: number) => void;
}) {
  const lowPct  = (low  / rangeMax) * 100;
  const highPct = (high / rangeMax) * 100;
  return (
    <div>
      <div className="price-track">
        <div className="rail" />
        <div className="fill" style={{ left: `${lowPct}%`, right: `${100 - highPct}%` }} />
        <input type="range" className="dual-range"
          style={{ zIndex: low > rangeMax - PRICE_STEP * 2 ? 5 : 3 }}
          min={0} max={rangeMax} step={PRICE_STEP} value={low}
          onChange={e => onChange(Math.min(+e.target.value, high - PRICE_STEP), high)}
        />
        <input type="range" className="dual-range"
          style={{ zIndex: 4 }}
          min={0} max={rangeMax} step={PRICE_STEP} value={high}
          onChange={e => onChange(low, Math.max(+e.target.value, low + PRICE_STEP))}
        />
      </div>
      <div className="price-vals">
        <span>{low === 0 ? 'AED 0' : `AED ${fmtK(low, rangeMax)}`}</span>
        <span className={high >= rangeMax ? 'mut' : ''}>
          {high >= rangeMax ? 'No max' : `AED ${fmtK(high, rangeMax)}`}
        </span>
      </div>
    </div>
  );
}

/* ── Hero search bar (exported, rendered in _ListingsView hero) ── */
export function ListingsSearchBar({ defaultQ, country, emirate, emiratesList, locationOptions = [] }: {
  defaultQ: string;
  country: string;
  emirate: string;
  emiratesList: { id: number; nameEn: string; slug: string }[];
  locationOptions?: { label: string; kind: 'community' | 'subCommunity' | 'building' | 'city' }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [inputQ, setInputQ] = useState(defaultQ);
  const [emirateSel, setEmirateSel] = useState(emirate);

  const kindLabel: Record<string, string> = {
    community: 'Area', subCommunity: 'Sub-area', building: 'Building', city: 'City',
  };

  function runSearch(qValue?: string) {
    const term = (qValue ?? inputQ).trim();
    const next = new URLSearchParams(sp.toString());
    if (term) next.set('q', term);
    else next.delete('q');
    next.delete('page');
    next.delete('country');
    next.delete('emirate');

    let base = '/listings';
    const nextCountry = emirateSel ? 'ae' : country;
    if (nextCountry) base += `/${nextCountry}`;
    if (nextCountry && emirateSel) base += `/${emirateSel}`;

    const qs = next.toString();
    router.push(`${base}${qs ? `?${qs}` : ''}`, { scroll: false });
  }

  return (
    <div className="lst-search">
      <div className="sfield">
        <Search size={18} />
        <input
          value={inputQ}
          list="lst-loc-options"
          onChange={e => {
            const v = e.target.value;
            setInputQ(v);
            // Picking an exact entry from the suggestion list searches immediately.
            if (locationOptions.some(o => o.label.toLowerCase() === v.toLowerCase())) runSearch(v);
          }}
          onKeyDown={e => e.key === 'Enter' && runSearch()}
          placeholder="Search by area, building or unit…"
        />
        <datalist id="lst-loc-options">
          {locationOptions.map(o => (
            <option key={o.kind + '|' + o.label} value={o.label}>{kindLabel[o.kind] ?? o.kind}</option>
          ))}
        </datalist>
      </div>
      <div className="sdiv" />
      <div className="sselect">
        <select value={emirateSel} onChange={e => setEmirateSel(e.target.value)}>
          <option value="">All emirates</option>
          {emiratesList.map(em => (
            <option key={em.id} value={em.slug}>{em.nameEn}</option>
          ))}
        </select>
        <span className="schev"><ChevronDown size={14} /></span>
      </div>
      <button className="sgo" onClick={() => runSearch()}>
        <Search size={14} />
        Search
      </button>
    </div>
  );
}

/* ── Filter sidebar content ───────────────────────────────────── */
export function FilterSidebar(
  props: FilterBarProps & { onNavigate: (o: Record<string, string>) => void; onClose?: () => void; counts?: Record<string, number> }
) {
  const { category, spaceType, bedrooms, bathrooms, furnishing, amenities, availability,
    minPrice, maxPrice, onNavigate, onClose, counts = {} } = props;

  const rangeMax  = PRICE_MAX[category] ?? PRICE_MAX[''];
  const initLow   = minPrice ? Math.min(Number(minPrice), rangeMax) : 0;
  const initHigh  = maxPrice ? Math.min(Number(maxPrice), rangeMax) : rangeMax;

  const [sliderLow,  setSliderLow]  = useState(initLow);
  const [sliderHigh, setSliderHigh] = useState(initHigh);

  useEffect(() => {
    setSliderLow(minPrice  ? Math.min(Number(minPrice),  rangeMax) : 0);
    setSliderHigh(maxPrice ? Math.min(Number(maxPrice),  rangeMax) : rangeMax);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, rangeMax]);

  const subTypes   = SPACE_TYPES[category] ?? [];
  const amenPool   = AMENITIES[category] ?? null;
  // Beds / baths / furnishing are residential-only facets — they make no sense
  // when browsing commercial / industrial / land (a shop has no bedrooms). For a
  // MIXED-USE browse they apply only while the user hasn't narrowed to commercial
  // sub-types: shown when no sub-type is picked or any picked sub-type is
  // residential, hidden once the selection is commercial-only.
  const selectedTypes = spaceType ? spaceType.split(',').filter(Boolean) : [];
  const mixedShowsResidential = selectedTypes.length === 0 || selectedTypes.some(isResidentialUnitType);
  const residentialFacets = !category || category === 'residential'
    || (category === 'mixed_use' && mixedShowsResidential);
  const showBeds   = residentialFacets;
  const showBaths  = residentialFacets;
  const showFurn   = residentialFacets;

  function handleCategory(val: string) {
    onNavigate({ category: val, spaceType: '', bedrooms: '', bathrooms: '', furnishing: '', amenities: '', minPrice: '', maxPrice: '' });
    onClose?.();
  }

  function handleSpaceType(val: string) {
    const cur  = spaceType ? spaceType.split(',').filter(Boolean) : [];
    const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
    onNavigate({ spaceType: next.join(',') });
  }

  function handleAmenity(val: string) {
    const cur  = amenities ? amenities.split(',').filter(Boolean) : [];
    const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
    onNavigate({ amenities: next.join(',') });
  }

  function handleBedrooms(val: string) {
    onNavigate({ bedrooms: bedrooms === val ? '' : val });
  }
  function handleBathrooms(val: string) {
    onNavigate({ bathrooms: bathrooms === val ? '' : val });
  }
  function handleFurnishing(val: string) {
    onNavigate({ furnishing: furnishing === val ? '' : val });
  }
  function handleAvailability(val: string) {
    onNavigate({ availability: availability === val ? '' : val });
  }
  function applyPrice() {
    onNavigate({
      minPrice: sliderLow  > 0       ? String(sliderLow)  : '',
      maxPrice: sliderHigh < rangeMax ? String(sliderHigh) : '',
    });
    onClose?.();
  }
  function clearAll() {
    setSliderLow(0); setSliderHigh(rangeMax);
    onNavigate({ category: '', spaceType: '', bedrooms: '', bathrooms: '', furnishing: '',
      amenities: '', availability: '', minPrice: '', maxPrice: '' });
    onClose?.();
  }

  /* Category icon map */
  const CatIcons: Record<string, React.ReactNode> = {
    '': <LayoutGrid size={16} />,
    residential: <Home size={16} />,
    commercial:  <Building2 size={16} />,
    industrial:  <Factory size={16} />,
    land:        <Mountain size={16} />,
    mixed_use:   <LayoutGrid size={16} />,
  };

  return (
    <div className="fcard">
      {/* Space Category */}
      <div className="fgroup">
        <span className="flabel">Space Category</span>
        <div className="catlist">
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              className={`catrow${category === cat.value ? ' active' : ''}`}
              onClick={() => handleCategory(cat.value)}
            >
              <span className="ci">{CatIcons[cat.value]}</span>
              {cat.label}
              {counts[cat.value || 'all'] != null && (
                <span className="cn">{counts[cat.value || 'all']}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-types */}
      {subTypes.length > 0 && (
        <div className="fgroup">
          <span className="flabel">{category.charAt(0).toUpperCase() + category.slice(1)} Type</span>
          <div className="checklist">
            {subTypes.map(({ label, value }) => {
              const selected = spaceType ? spaceType.split(',').filter(Boolean) : [];
              const on = selected.includes(value);
              return (
                <label key={value} className={`checkrow${on ? ' on' : ''}`} onClick={() => handleSpaceType(value)}>
                  <span className="box">{on && <CheckSVG />}</span>
                  {label}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Bedrooms */}
      {showBeds && (
        <div className="fgroup">
          <span className="flabel">Bedrooms</span>
          <div className="bedrow">
            {BEDROOM_OPTIONS.map(({ label, value }) => (
              <button key={value} className={`bedpill${bedrooms === value ? ' on' : ''}`}
                onClick={() => handleBedrooms(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bathrooms */}
      {showBaths && (
        <div className="fgroup">
          <span className="flabel">Bathrooms</span>
          <div className="bedrow">
            {BATH_OPTIONS.map(({ label, value }) => (
              <button key={value} className={`bedpill${bathrooms === value ? ' on' : ''}`}
                onClick={() => handleBathrooms(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Furnishing */}
      {showFurn && (
        <div className="fgroup">
          <span className="flabel">Furnishing</span>
          <div className="bedrow">
            {FURNISHING_OPTIONS.map(({ label, value }) => (
              <button key={value} className={`bedpill${furnishing === value ? ' on' : ''}`}
                onClick={() => handleFurnishing(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Amenities */}
      {amenPool && (
        <div className="fgroup">
          <span className="flabel">Amenities</span>
          <div className="checklist">
            {amenPool.map(({ value, label }) => {
              const on = amenities ? amenities.split(',').filter(Boolean).includes(value) : false;
              return (
                <label key={value} className={`checkrow${on ? ' on' : ''}`} onClick={() => handleAmenity(value)}>
                  <span className="box">{on && <CheckSVG />}</span>
                  {label}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Availability */}
      <div className="fgroup">
        <span className="flabel">Availability</span>
        <div className="bedrow">
          {AVAILABILITY_OPTIONS.map(({ label, value }) => (
            <button key={value} className={`bedpill${availability === value ? ' on' : ''}`}
              onClick={() => handleAvailability(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Price Range */}
      <div className="fgroup">
        <span className="flabel">Price Range <span className="muted">· AED/yr</span></span>
        <PriceRangeSlider
          rangeMax={rangeMax}
          low={sliderLow}
          high={sliderHigh}
          onChange={(l, h) => { setSliderLow(l); setSliderHigh(h); }}
        />
        <button className="fapply" onClick={applyPrice}>Apply price</button>
        <button className="fclear" onClick={clearAll}>Reset all filters</button>
      </div>
    </div>
  );
}

/* ── Top filter bar + emirate strip + mobile drawer ───────────── */
export default function FilterBar(props: FilterBarProps) {
  const {
    category, spaceType, bedrooms, bathrooms, furnishing, amenities, availability,
    minPrice, maxPrice, sort, view, q,
    emirate, country, emirateName, countryName, emiratesList, total,
  } = props;

  const router  = useRouter();
  const sp      = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Browser Back closes the mobile filter drawer instead of navigating away; scrim /
  // X / sidebar-apply route through the same path. Active only while open. See useBackClose.
  const dismissMobile = useBackClose(() => setMobileOpen(false), mobileOpen);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const navigate = useCallback((overrides: Record<string, string>) => {
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
  }, [sp, router, country, emirate]);

  /* Active pills */
  const pills: { label: string; clear: Record<string, string> }[] = [];
  if (country) pills.push({ label: countryName || country.toUpperCase(), clear: { country: '', emirate: '' } });
  if (emirate) pills.push({ label: emirateName || emirate, clear: { emirate: '' } });
  if (category) {
    const catLabel = CATEGORIES.find(c => c.value === category)?.label ?? categoryDisplayLabel(category);
    pills.push({ label: catLabel, clear: { category: '', spaceType: '', bedrooms: '', bathrooms: '', furnishing: '', amenities: '' } });
  }
  if (spaceType) {
    const allTypes = Object.values(SPACE_TYPES).flat();
    spaceType.split(',').filter(Boolean).forEach(st => {
      const found = allTypes.find(t => t.value === st);
      const rest  = spaceType.split(',').filter(v => v !== st).join(',');
      pills.push({ label: found?.label ?? st, clear: { spaceType: rest } });
    });
  }
  if (bedrooms !== '') {
    const b = BEDROOM_OPTIONS.find(o => o.value === bedrooms);
    pills.push({ label: b?.label === 'Studio' ? 'Studio' : `${b?.label} Bed${b?.value === '1' ? '' : 's'}`, clear: { bedrooms: '' } });
  }
  if (bathrooms !== '') {
    const bath = BATH_OPTIONS.find(o => o.value === bathrooms);
    pills.push({ label: `${bath?.label ?? bathrooms} Bath${bathrooms === '1' ? '' : 's'}`, clear: { bathrooms: '' } });
  }
  if (furnishing) {
    const f = FURNISHING_OPTIONS.find(o => o.value === furnishing);
    pills.push({ label: f?.label ?? furnishing, clear: { furnishing: '' } });
  }
  if (amenities) {
    amenities.split(',').filter(Boolean).forEach(a => {
      const found = Object.values(AMENITIES).flat().find(am => am.value === a);
      const rest  = amenities.split(',').filter(v => v !== a).join(',');
      pills.push({ label: found?.label ?? a, clear: { amenities: rest } });
    });
  }
  if (availability) {
    const av = AVAILABILITY_OPTIONS.find(o => o.value === availability);
    pills.push({ label: av?.label ?? availability, clear: { availability: '' } });
  }
  if (minPrice || maxPrice) {
    const lo = minPrice ? `AED ${Number(minPrice).toLocaleString()}` : 'AED 0';
    const hi = maxPrice ? `AED ${Number(maxPrice).toLocaleString()}` : 'Any';
    pills.push({ label: `${lo} – ${hi}`, clear: { minPrice: '', maxPrice: '' } });
  }
  if (q) pills.push({ label: `"${q}"`, clear: { q: '' } });

  const activeCount = pills.length;

  return (
    <>
      {/* ── Results bar ───────────────────────────────────── */}
      <div className="rbar">
        <p className="found">
          <b>{total.toLocaleString()}</b> {total === 1 ? 'space' : 'spaces'} available
          {emirate && emirateName ? ` in ${emirateName}` : ''}
        </p>
        <div className="rtools">
          {/* Mobile filter button */}
          <button className="mobfilter" onClick={() => setMobileOpen(true)}>
            <SlidersHorizontal size={15} />
            Filters
            {activeCount > 0 && <span className="cnt">{activeCount}</span>}
          </button>

          {/* Sort */}
          <div className="sortsel">
            <select value={sort || 'newest'} onChange={e => navigate({ sort: e.target.value })}>
              <option value="price_asc">Price: Low → High</option>
              <option value="price_desc">Price: High → Low</option>
              <option value="newest">Newest First</option>
            </select>
            <span className="schev"><ChevronDown size={14} /></span>
          </div>

          {/* View toggle */}
          <div className="viewtog">
            <button className={view !== 'list' ? 'on' : ''} onClick={() => navigate({ view: 'grid' })} aria-label="Grid view">
              <LayoutGrid size={17} />
            </button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => navigate({ view: 'list' })} aria-label="List view">
              <Rows3 size={17} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Active pills ──────────────────────────────────── */}
      {pills.length > 0 && (
        <div className="activepills">
          {pills.map((pill, i) => (
            <span key={i} className="apill">
              {pill.label}
              <button onClick={() => navigate(pill.clear)} aria-label="Remove filter">
                <X size={12} />
              </button>
            </span>
          ))}
          {pills.length > 1 && (
            <button className="clearall" onClick={() => navigate({
              country: '', emirate: '', category: '', spaceType: '', bedrooms: '',
              bathrooms: '', furnishing: '', amenities: '', availability: '',
              minPrice: '', maxPrice: '', q: '',
            })}>
              Clear all
            </button>
          )}
        </div>
      )}

      {/* ── Mobile drawer ────────────────────────────────── */}
      {mobileOpen && (
        <>
          <div className="drawer-scrim" onClick={dismissMobile} />
          <div className="drawer open">
            <div className="drawer-head">
              <h3>Filters</h3>
              <button className="dx" onClick={dismissMobile} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="drawer-body">
              <FilterSidebar {...props} onNavigate={navigate} onClose={dismissMobile} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
