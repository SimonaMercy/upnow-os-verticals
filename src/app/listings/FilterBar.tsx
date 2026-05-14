'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

/* ── Sub-category data (matches UnitType enum in backend) ─────────── */
const SPACE_TYPES: Record<string, { label: string; value: string }[]> = {
  residential: [
    { label: 'Apartment',    value: 'apartment' },
    { label: 'Villa',        value: 'villa' },
    { label: 'Townhouse',    value: 'townhouse' },
    { label: 'Studio',       value: 'studio' },
    { label: 'Penthouse',    value: 'penthouse' },
    { label: 'Duplex / Loft', value: 'duplex_loft' },
  ],
  commercial: [
    { label: 'Retail Shop',        value: 'retail_shop' },
    { label: 'Showroom',           value: 'showroom' },
    { label: 'Fitted Office',      value: 'office_fitted' },
    { label: 'Shell & Core Office', value: 'office_shell_core' },
    { label: 'Restaurant / F&B',   value: 'restaurant_fnb' },
    { label: 'Clinic / Medical',   value: 'clinic_medical' },
  ],
  industrial: [
    { label: 'Warehouse',           value: 'warehouse' },
    { label: 'Open Yard',           value: 'open_yard' },
    { label: 'Storage Unit',        value: 'storage_unit' },
    { label: 'Cold Storage',        value: 'cold_storage' },
    { label: 'Logistics Facility',  value: 'logistics_facility' },
  ],
};

const BEDROOM_OPTIONS = [
  { label: 'Studio', value: '0' },
  { label: '1',      value: '1' },
  { label: '2',      value: '2' },
  { label: '3',      value: '3' },
  { label: '4',      value: '4' },
  { label: '5+',     value: '5' },
];

const CATEGORIES = [
  { label: 'All',         value: '' },
  { label: 'Residential', value: 'residential' },
  { label: 'Commercial',  value: 'commercial' },
  { label: 'Industrial',  value: 'industrial' },
];

/* Max price ceiling per category (AED/year) */
const PRICE_MAX: Record<string, number> = {
  residential: 300_000,
  commercial:  1_000_000,
  industrial:  2_000_000,
  '':          1_000_000,
};
const PRICE_STEP = 5_000;

/* ── Helpers ────────────────────────────────────────────────────────── */
function fmtK(n: number, max: number) {
  if (n >= max) return 'Any';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/* ── Dual range slider ──────────────────────────────────────────────── */
function PriceRangeSlider({
  rangeMax, low, high, onChange,
}: {
  rangeMax: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
}) {
  const lowPct  = (low  / rangeMax) * 100;
  const highPct = (high / rangeMax) * 100;

  return (
    <div>
      {/* Track */}
      <div className="relative" style={{ height: 24 }}>
        {/* Background track */}
        <div
          className="absolute rounded-full"
          style={{ top: '50%', transform: 'translateY(-50%)', left: 0, right: 0, height: 4, backgroundColor: '#e8e6e0' }}
        />
        {/* Active fill */}
        <div
          className="absolute rounded-full"
          style={{
            top: '50%', transform: 'translateY(-50%)',
            left: `${lowPct}%`, right: `${100 - highPct}%`,
            height: 4, backgroundColor: '#2e9f82',
          }}
        />
        {/* Low thumb */}
        <input
          type="range"
          className="dual-range absolute w-full"
          style={{ top: 0, left: 0, zIndex: low > rangeMax - PRICE_STEP ? 5 : 3 }}
          min={0}
          max={rangeMax}
          step={PRICE_STEP}
          value={low}
          onChange={e => {
            const v = Math.min(Number(e.target.value), high - PRICE_STEP);
            onChange(v, high);
          }}
        />
        {/* High thumb */}
        <input
          type="range"
          className="dual-range absolute w-full"
          style={{ top: 0, left: 0, zIndex: 4 }}
          min={0}
          max={rangeMax}
          step={PRICE_STEP}
          value={high}
          onChange={e => {
            const v = Math.max(Number(e.target.value), low + PRICE_STEP);
            onChange(low, v);
          }}
        />
      </div>
      {/* Labels */}
      <div className="flex justify-between mt-2 text-xs" style={{ color: '#6b6860' }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {low === 0 ? 'AED 0' : `AED ${low.toLocaleString()}`}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmtK(high, rangeMax) === 'Any' ? 'No max' : `AED ${high.toLocaleString()}`}
        </span>
      </div>
    </div>
  );
}

/* ── Props ──────────────────────────────────────────────────────────────────── */
interface Props {
  category:    string;
  spaceType:   string;
  bedrooms:    string;
  minPrice:    string;
  maxPrice:    string;
  sort:        string;
  q:           string;
  /** Emirate slug from URL path, e.g. 'dubai', 'abu-dhabi' */
  emirate:     string;
  /** Lowercase ISO country code from URL path, e.g. 'ae', 'sa' */
  country:     string;
  /** Display name for the emirate pill, e.g. 'Dubai' */
  emirateName: string;
  /** Display name for the country pill, e.g. 'United Arab Emirates' */
  countryName: string;
  /** Full country list from server — no client fetch needed */
  countriesList: { id: number; code: string; nameEn: string }[];
  /** Full emirate list from server — rendered as horizontal strip */
  emiratesList:  { id: number; nameEn: string; slug: string }[];
  total:       number;
}

/* ── Sidebar content (shared between desktop aside + mobile drawer) ── */
export function FilterSidebar({
  category, spaceType, bedrooms, minPrice, maxPrice, country, countriesList,
  onNavigate, onClose,
}: Props & { onNavigate: (overrides: Record<string, string>) => void; onClose?: () => void }) {
  const rangeMax  = PRICE_MAX[category] ?? PRICE_MAX[''];
  const initLow   = minPrice ? Math.min(Number(minPrice), rangeMax) : 0;
  const initHigh  = maxPrice ? Math.min(Number(maxPrice), rangeMax) : rangeMax;

  const [sliderLow,  setSliderLow]  = useState(initLow);
  const [sliderHigh, setSliderHigh] = useState(initHigh);

  /* Sync slider when category (and thus rangeMax) changes */
  useEffect(() => {
    setSliderLow(minPrice ? Math.min(Number(minPrice), rangeMax) : 0);
    setSliderHigh(maxPrice ? Math.min(Number(maxPrice), rangeMax) : rangeMax);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, rangeMax]);

  const subTypes = SPACE_TYPES[category] ?? [];

  function handleCategoryClick(val: string) {
    onNavigate({ category: val, spaceType: '', bedrooms: '', minPrice: '', maxPrice: '' });
    onClose?.();
  }

  function handleCountry(code: string) {
    // code is lowercase ISO code ('ae', 'sa', …); switching clears emirate
    onNavigate({ country: country === code ? '' : code, emirate: '' });
    onClose?.();
  }

  function handleSpaceType(val: string) {
    onNavigate({ spaceType: spaceType === val ? '' : val });
    onClose?.();
  }

  function handleBedrooms(val: string) {
    onNavigate({ bedrooms: bedrooms === val ? '' : val });
    onClose?.();
  }

  function applyPrice() {
    const min = sliderLow  > 0        ? String(sliderLow)  : '';
    const max = sliderHigh < rangeMax ? String(sliderHigh) : '';
    onNavigate({ minPrice: min, maxPrice: max });
    onClose?.();
  }

  function clearAll() {
    setSliderLow(0);
    setSliderHigh(rangeMax);
    onNavigate({ country: '', emirate: '', category: '', spaceType: '', bedrooms: '', minPrice: '', maxPrice: '' });
    onClose?.();
  }

  return (
    <div className="flex flex-col">

      {/* ── Space Category ──────────────────────────────────────── */}
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9b9890' }}>
        Space Category
      </p>
      <div className="flex flex-col" style={{ gap: 2 }}>
        {CATEGORIES.map((cat) => {
          const active = category === cat.value;
          return (
            <button
              key={cat.value}
              onClick={() => handleCategoryClick(cat.value)}
              className="w-full text-left text-sm transition-colors"
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                backgroundColor: active ? '#edf7f3' : 'transparent',
                borderLeft: active ? '3px solid #2e9f82' : '3px solid transparent',
                paddingLeft: active ? 9 : 12,
                color: active ? '#2e9f82' : '#3d3b35',
                fontWeight: active ? 500 : 400,
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ── Sub-categories (per category) ───────────────────────── */}
      {subTypes.length > 0 && (
        <>
          <hr className="my-4 border-[#e8e6e0]" />
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9b9890' }}>
            {category.charAt(0).toUpperCase() + category.slice(1)} Type
          </p>
          <div className="flex flex-col" style={{ gap: 6 }}>
            {subTypes.map(({ label, value }) => {
              const active = spaceType === value;
              return (
                <label
                  key={value}
                  className="flex items-center gap-2.5 cursor-pointer rounded-lg px-2 py-1.5 text-sm transition-colors"
                  style={{
                    backgroundColor: active ? '#edf7f3' : 'transparent',
                    color: active ? '#2e9f82' : '#3d3b35',
                  }}
                >
                  <span
                    className="flex-shrink-0 rounded"
                    style={{
                      width: 16, height: 16,
                      border: active ? '2px solid #2e9f82' : '1.5px solid #c8c6c0',
                      backgroundColor: active ? '#2e9f82' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onClick={() => handleSpaceType(value)}
                  >
                    {active && (
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                        <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span onClick={() => handleSpaceType(value)}>{label}</span>
                </label>
              );
            })}
          </div>
        </>
      )}

      {/* ── Bedrooms (residential only) ─────────────────────────── */}
      {category === 'residential' && (
        <>
          <hr className="my-4 border-[#e8e6e0]" />
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9b9890' }}>
            Bedrooms
          </p>
          <div className="flex flex-wrap gap-2">
            {BEDROOM_OPTIONS.map(({ label, value }) => {
              const active = bedrooms === value;
              return (
                <button
                  key={value}
                  onClick={() => handleBedrooms(value)}
                  className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? '#2e9f82' : '#f4f3ef',
                    color: active ? '#fff' : '#3d3b35',
                    border: 'none',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Price Range ─────────────────────────────────────────── */}
      <hr className="my-4 border-[#e8e6e0]" />
      <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: '#9b9890' }}>
        Price Range <span className="normal-case font-normal" style={{ color: '#9b9890' }}>(AED/yr)</span>
      </p>
      <PriceRangeSlider
        rangeMax={rangeMax}
        low={sliderLow}
        high={sliderHigh}
        onChange={(l, h) => { setSliderLow(l); setSliderHigh(h); }}
      />
      {/* Manual text inputs */}
      <div className="flex gap-2 mt-3">
        <div className="flex-1 min-w-0">
          <label className="block text-xs mb-1" style={{ color: '#6b6860' }}>Min</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={sliderLow === 0 ? '' : String(sliderLow)}
            onChange={e => {
              const v = Number(e.target.value.replace(/[^0-9]/g, '')) || 0;
              setSliderLow(Math.min(v, sliderHigh - PRICE_STEP));
            }}
            className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
            style={{ color: '#1a1916' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-xs mb-1" style={{ color: '#6b6860' }}>Max</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Any"
            value={sliderHigh >= rangeMax ? '' : String(sliderHigh)}
            onChange={e => {
              const raw = e.target.value.replace(/[^0-9]/g, '');
              const v = raw === '' ? rangeMax : Math.max(Number(raw), sliderLow + PRICE_STEP);
              setSliderHigh(v);
            }}
            className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
            style={{ color: '#1a1916' }}
          />
        </div>
      </div>

      {/* Apply + Clear */}
      <button
        onClick={applyPrice}
        className="w-full mt-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: '#2e9f82' }}
      >
        Apply Filters
      </button>
      <button
        onClick={clearAll}
        className="block w-full text-center text-sm mt-2 hover:opacity-70 transition-opacity"
        style={{ color: '#2e9f82', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        Clear all
      </button>
    </div>
  );
}

/* ── Top filter bar (results count + active pills + sort + mobile btn) */
export default function FilterBar(props: Props) {
  const { category, spaceType, bedrooms, minPrice, maxPrice, sort, q, emirate, country, emirateName, countryName, emiratesList, total } = props;
  const router = useRouter();
  const sp = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  /**
   * Navigate with overrides. Keys 'country' and 'emirate' alter the URL path;
   * all other keys become query parameters.
   */
  const navigate = useCallback((overrides: Record<string, string>) => {
    // Resolve new path segments
    const nextCountry = 'country' in overrides ? overrides.country : country;
    const nextEmirate = 'emirate' in overrides ? overrides.emirate : emirate;

    // Build base path
    let basePath = '/listings';
    if (nextCountry) basePath += `/${nextCountry}`;
    if (nextCountry && nextEmirate) basePath += `/${nextEmirate}`;

    // Carry over existing query params then apply overrides (excluding path keys)
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (k === 'country' || k === 'emirate') continue;
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // Remove any stale path keys that might be in the query string
    next.delete('country');
    next.delete('emirate');
    next.delete('page');

    const qs = next.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ''}`);
  }, [sp, router, country, emirate]);

  /* Build active pills */
  const pills: { label: string; clear: Record<string, string> }[] = [];
  if (country) {
    pills.push({ label: countryName || country.toUpperCase(), clear: { country: '', emirate: '' } });
  }
  if (emirate) {
    pills.push({ label: emirateName || emirate, clear: { emirate: '' } });
  }
  if (category) {
    pills.push({ label: category.charAt(0).toUpperCase() + category.slice(1), clear: { category: '', spaceType: '', bedrooms: '' } });
  }
  if (spaceType) {
    const found = Object.values(SPACE_TYPES).flat().find(t => t.value === spaceType);
    pills.push({ label: found?.label ?? spaceType, clear: { spaceType: '' } });
  }
  if (bedrooms !== '') {
    const b = BEDROOM_OPTIONS.find(o => o.value === bedrooms);
    if (b) pills.push({ label: b.label === 'Studio' ? 'Studio' : `${b.label} Bed${b.value === '1' ? '' : 's'}`, clear: { bedrooms: '' } });
  }
  if (minPrice || maxPrice) {
    const lo = minPrice ? `AED ${Number(minPrice).toLocaleString()}` : 'AED 0';
    const hi = maxPrice ? `AED ${Number(maxPrice).toLocaleString()}` : 'Any';
    pills.push({ label: `${lo} – ${hi}`, clear: { minPrice: '', maxPrice: '' } });
  }
  if (q) {
    pills.push({ label: `"${q}"`, clear: { q: '' } });
  }

  return (
    <>
      {/* ── Top bar ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm" style={{ color: '#9b9890' }}>
            <span style={{ color: '#3d3b35', fontWeight: 500 }}>{total.toLocaleString()}</span>
            {' '}listing{total !== 1 ? 's' : ''} found
          </p>
          {pills.map((pill, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{ backgroundColor: '#edf7f3', color: '#2e9f82' }}
            >
              {pill.label}
              <button onClick={() => navigate(pill.clear)} className="hover:opacity-60 cursor-pointer" style={{ lineHeight: 0 }}>
                <X size={11} />
              </button>
            </span>
          ))}
          {pills.length > 1 && (
            <button
              onClick={() => navigate({ country: '', emirate: '', category: '', spaceType: '', bedrooms: '', minPrice: '', maxPrice: '', q: '' })}
              className="text-xs hover:underline"
              style={{ color: '#9b9890' }}
            >
              Clear all
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Sort */}
          <select
            value={sort || 'price_asc'}
            onChange={e => navigate({ sort: e.target.value })}
            className="text-sm border border-[#e8e6e0] rounded-lg bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
            style={{ padding: '8px 12px', color: '#1a1916' }}
          >
            <option value="price_asc">Price: Low → High</option>
            <option value="price_desc">Price: High → Low</option>
            <option value="newest">Newest First</option>
          </select>

          {/* Mobile filter button */}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex md:hidden items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: '#f4f3ef', color: '#3d3b35' }}
          >
            <SlidersHorizontal size={15} />
            Filters
            {pills.length > 0 && (
              <span className="rounded-full w-5 h-5 text-xs flex items-center justify-center text-white" style={{ backgroundColor: '#2e9f82' }}>
                {pills.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Emirate strip ──────────────────────────────────────────────── */}
      {emiratesList.length > 0 && (!country || country === 'ae') && (
        <div className="mb-6 pb-5" style={{ borderBottom: '1px solid #e8e6e0' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9b9890' }}>
            Select Emirate
          </p>
          {/* Wrapper with right-fade hint for overflow */}
          <div className="relative">
            <div
              className="flex items-center gap-2 overflow-x-auto"
              style={{ scrollbarWidth: 'none' } as React.CSSProperties}
            >
              {/* All Emirates */}
              <button
                onClick={() => navigate({ emirate: '' })}
                className="flex-shrink-0 text-sm font-medium cursor-pointer transition-all"
                style={{
                  padding: '7px 18px',
                  borderRadius: 999,
                  backgroundColor: !emirate ? '#2e9f82' : '#fff',
                  color:           !emirate ? '#fff'    : '#3d3b35',
                  border:          !emirate ? '1.5px solid #2e9f82' : '1.5px solid #dddbd5',
                  whiteSpace: 'nowrap',
                  boxShadow: !emirate ? '0 2px 10px rgba(46,159,130,0.22)' : 'none',
                  fontWeight: 500,
                }}
              >
                All
              </button>

              {emiratesList.map((em) => {
                const active = emirate === em.slug;
                return (
                  <button
                    key={em.id}
                    onClick={() => navigate({ emirate: active ? '' : em.slug, country: 'ae' })}
                    className="flex-shrink-0 text-sm font-medium cursor-pointer transition-all"
                    style={{
                      padding: '7px 18px',
                      borderRadius: 999,
                      backgroundColor: active ? '#2e9f82' : '#fff',
                      color:           active ? '#fff'    : '#3d3b35',
                      border:          active ? '1.5px solid #2e9f82' : '1.5px solid #dddbd5',
                      whiteSpace: 'nowrap',
                      boxShadow: active ? '0 2px 10px rgba(46,159,130,0.22)' : 'none',
                      fontWeight: 500,
                    }}
                  >
                    {em.nameEn}
                  </button>
                );
              })}
            </div>
            {/* Right fade gradient — hints that more pills are scrollable */}
            <div
              className="absolute top-0 right-0 h-full w-10 pointer-events-none"
              style={{ background: 'linear-gradient(to right, transparent, #f9f8f5)' }}
            />
          </div>
        </div>
      )}

      {/* ── Mobile drawer ─────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div
            className="relative ml-auto h-full w-[320px] max-w-[90vw] overflow-y-auto bg-white p-6"
            style={{ boxShadow: '-4px 0 24px rgba(0,0,0,0.12)' }}
          >
            <div className="flex items-center justify-between mb-6">
              <span className="font-semibold text-base" style={{ color: '#1a1916' }}>Filters</span>
              <button onClick={() => setMobileOpen(false)} className="p-1 rounded-lg hover:bg-[#f4f3ef]">
                <X size={18} style={{ color: '#6b6860' }} />
              </button>
            </div>
            <FilterSidebar {...props} onNavigate={navigate} onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
