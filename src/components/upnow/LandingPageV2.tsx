'use client';

import { useState, useRef, useEffect } from 'react';
import { serviceImg as sharedServiceImg } from '@/lib/serviceImages';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2, Home, Factory, Wrench, Wind, Star, MapPin, Heart, Search, ArrowRight, ChevronDown, Check, Grid3X3, Mountain, Sparkles, Droplets, Zap, Hammer, PaintRoller, Bug, Car,
} from 'lucide-react';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import { Footer } from '@/components/upnow/Footer';
import { SiteHeader } from '@/components/upnow/SiteHeader';

// ─── helpers ────────────────────────────────────────────────────────────────

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

function photoUrl(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.startsWith('http') ? raw : `${BACKEND}${raw}`;
}

function formatAed(val: number | string | null | undefined): string {
  if (val == null) return 'Price on request';
  const n = Number(val);
  if (isNaN(n)) return 'Price on request';
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(1)}M`;
  return `AED ${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// ─── API types ───────────────────────────────────────────────────────────────

interface ListingUnit {
  id: number;
  unitName: string | null;
  unitType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  unitSizeSqft: number | null;
  rentalPrice: number | null;
}

interface ListingProperty {
  id: number;
  buildingName: string | null;
  fullAddress: string | null;
  spaceCategory: string;
  emirate?: { nameEn: string } | null;
  community?: { nameEn: string } | null;
}

interface ListingItem {
  unit: ListingUnit;
  property: ListingProperty;
  coverPhotoUrl: string | null;
}

function mapToSpaceItem(item: ListingItem): SpaceItem {
  const { unit, property, coverPhotoUrl } = item;
  const emirate = property.emirate?.nameEn ?? '';
  const community = property.community?.nameEn ?? '';
  const loc = [community, emirate].filter(Boolean).join(', ') || property.fullAddress || 'UAE';
  const tag = [
    isResidentialUnitType(unit.unitType) && unit.bedrooms ? `${unit.bedrooms} bed` : null,
    unit.unitSizeSqft ? `${Number(unit.unitSizeSqft).toLocaleString('en-US', { maximumFractionDigits: 0 })} sqft` : null,
  ].filter(Boolean).join(' · ') || undefined;
  return {
    id: unit.id,
    title: unit.unitName || property.buildingName || 'Listing',
    loc,
    price: formatAed(unit.rentalPrice),
    per: '/year',
    rate: 0,
    tag,
    img: coverPhotoUrl ? photoUrl(coverPhotoUrl) : fallbackImg(property.spaceCategory, unit.id),
  };
}

function phClass(seed: string): string {
  const n = ((seed.charCodeAt(0) ?? 65) + (seed.charCodeAt(1) ?? 66)) % 6;
  return `l-ph-${n + 1}`;
}

// ─── data ────────────────────────────────────────────────────────────────────

interface SpaceItem {
  id?: number;
  title: string;
  loc: string;
  price: string;
  per: string;
  rate: number;
  badge?: string;
  tag?: string;
  img: string;
}

interface SpaceCat {
  id: string;
  label: string;
  blurb: string;
  href: string;
  items: SpaceItem[];
}

interface ServiceItem {
  title: string;
  price: string;
  per: string;
  meta: string;      // honest meta line — category · duration/packages
  badge?: string;
  img: string;
  href: string;      // direct booking page
}

interface ServiceCat {
  id: string;
  label: string;
  blurb: string;
  href: string;
  items: ServiceItem[];
}

const SPACE_CAT_DEFS: Omit<SpaceCat, 'items'>[] = [
  { id: 'residential', label: 'Residential', blurb: 'Apartments, villas, studios & townhouses', href: '/listings?category=residential' },
  { id: 'commercial',  label: 'Commercial',  blurb: 'Offices, retail, coworking & showrooms',   href: '/listings?category=commercial' },
  { id: 'industrial',  label: 'Industrial',  blurb: 'Warehouses, storage & cold storage',        href: '/listings?category=industrial' },
  { id: 'land',        label: 'Land',        blurb: 'Plots & development land',                  href: '/listings?category=land' },
  { id: 'mixed_use',   label: 'Mixed-use',   blurb: 'Combined residential & commercial spaces',  href: '/listings?category=mixed_use' },
];

const UPH = 'https://images.unsplash.com/photo-';
const UQ  = '?auto=format&fit=crop&w=640&q=70';

const FALLBACK_IMGS: Record<string, string[]> = {
  residential: [
    '1502672260266-1c1ef2d93688', '1493809842364-78817add7ffb',
    '1580587771525-78b9dba3b914', '1545324418-cc1a3fa10c00',
    '1512917774080-9991f1c4c750', '1484154218962-a197022b5858',
    '1560448204-e02f11c3d0e2', '1522708323590-d24dbb6b0267',
  ],
  commercial: [
    '1497366216548-37526070297c', '1441986300917-64674bd600d8',
    '1497366811353-6870744d04b2', '1524758631624-e2822e304c36',
    '1497366412874-3415097a27fe', '1431540015161-0bf868a2d407',
  ],
  industrial: [
    '1586528116311-ad8dd3c8310d', '1553413077-190dd305871c',
    '1601598851547-4302969d0614', '1578575437130-527eed3abbec',
    '1565793971055-2c4ef51ebe57',
  ],
  land: [
    '1500382017468-9049fed747ef', '1416879595882-3373a0480b5b',
    '1501785888041-af3ef285b470', '1469474968028-56623f02e42e',
  ],
  mixed_use: [
    '1486406146926-c627a92ad1ab', '1493397212122-2b85dda8d643',
    '1449824913935-59a10b8d2000', '1518005020951-eccb494ad742',
  ],
};

function fallbackImg(category: string, id: number): string {
  const pool = FALLBACK_IMGS[category] ?? FALLBACK_IMGS.residential;
  return `${UPH}${pool[id % pool.length]}${UQ}`;
}

// Landing category imagery — keyed by REAL catalog codes (migr 0107 taxonomy).
// The rails themselves render from GET /api/catalog/public; nothing hardcoded.

interface PublicCatalogService {
  code: string; name: string; pricingMode: string; priceUnit: string;
  basePrice: number | null; isFromPrice: boolean; isEmergency: boolean;
  estimatedDuration: number | null; estimatedDurationMax: number | null;
  packages: { id: number }[]; packageGroupLabel: string | null;
  imageUrl?: string | null;
}
interface PublicCatalogCategory {
  code: string; name: string; imageUrl?: string | null;
  services: PublicCatalogService[];
}

function svcPrice(sv: PublicCatalogService): { price: string; per: string } {
  if (sv.pricingMode === 'quote' || sv.basePrice == null) return { price: 'Free quote', per: '' };
  return {
    price: `AED ${Number(sv.basePrice).toLocaleString('en-AE')}`,
    per: sv.priceUnit === 'per_hour' ? '/hour' : '',
  };
}
function svcMeta(catName: string, sv: PublicCatalogService): string {
  if (sv.packages.length > 0) return `${catName} · ${sv.packages.length} ${(sv.packageGroupLabel || 'options').toLowerCase()} options`;
  if (sv.estimatedDuration) {
    const f = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);
    return `${catName} · ${f(sv.estimatedDuration)}${sv.estimatedDurationMax && sv.estimatedDurationMax !== sv.estimatedDuration ? `–${f(sv.estimatedDurationMax)}` : ''}`;
  }
  return `${catName} · Vetted, licensed providers`;
}
/** Map the admin-configured catalog into the landing rail model. */
function toServiceCats(categories: PublicCatalogCategory[]): ServiceCat[] {
  return categories
    .filter((c) => c.code !== 'commercial_services' && c.services.length > 0)
    .map((c) => ({
      id: c.code,
      label: c.name,
      blurb: c.services.slice(0, 4).map((sv) => sv.name).join(', '),
      href: `/services?category=${c.code}`,
      items: c.services.slice(0, 4).map((sv, i) => {
        const { price, per } = svcPrice(sv);
        return {
          title: sv.name,
          price,
          per,
          meta: svcMeta(c.name, sv),
          badge: sv.isEmergency ? '24/7' : sv.pricingMode === 'quote' ? 'Free quote' : undefined,
          img: sharedServiceImg(sv.code, c.code, i, sv.imageUrl),
          href: `/services/book/${sv.code}`,
        };
      }),
    }));
}

const SPACE_CAT_ICONS: Record<string, React.ReactNode> = {
  residential: <Home size={16} />,
  commercial: <Building2 size={16} />,
  industrial: <Factory size={16} />,
  land: <Mountain size={16} />,
  mixed_use: <Grid3X3 size={16} />,
};

const SERVICE_CAT_ICONS: Record<string, React.ReactNode> = {
  home_cleaning: <Sparkles size={16} />,
  ac_services: <Wind size={16} />,
  plumbing: <Droplets size={16} />,
  electrical: <Zap size={16} />,
  handyman: <Hammer size={16} />,
  painting: <PaintRoller size={16} />,
  pest_control: <Bug size={16} />,
  car_vehicle: <Car size={16} />,
  commercial_services: <Wrench size={16} />,
};

// ─── SpaceCard ────────────────────────────────────────────────────────────────

function SpaceCard({ item }: { item: SpaceItem }) {
  const [saved, setSaved] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const pc = phClass(item.title);
  const href = item.id ? `/listings/units/${item.id}` : '/listings';

  return (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
    <article className="l-pcard">
      <div className="ph">
        <div className={`img ${pc}`}>
          <div className="l-ph-glyph"><Building2 size={46} /></div>
          {!imgErr && (
            <img src={item.img} alt={item.title} onError={() => setImgErr(true)} />
          )}
        </div>
        {item.badge && <span className="badge">{item.badge}</span>}
        <button
          className="heart"
          onClick={(e) => { e.preventDefault(); setSaved((v) => !v); }}
          aria-label={saved ? 'Remove from wishlist' : 'Save'}
        >
          <Heart size={14} fill={saved ? '#e74c3c' : 'none'} stroke={saved ? '#e74c3c' : 'currentColor'} />
        </button>
        {item.tag && (
          <span className="tag">
            <MapPin size={10} style={{ display: 'inline', marginRight: 3 }} />{item.tag}
          </span>
        )}
      </div>
      <div className="body">
        <div className="r1">
          <div className="ttl">{item.title}</div>
          {item.rate > 0 && (
            <span className="rate">
              <Star size={12} fill="#d99036" stroke="none" style={{ display: 'inline', marginRight: 3 }} />
              {item.rate}
            </span>
          )}
        </div>
        <div className="loc">
          <MapPin size={11} style={{ display: 'inline', marginRight: 3, verticalAlign: '-2px' }} />
          {item.loc}
        </div>
        <div className="price">{item.price} <small>{item.per}</small></div>
      </div>
    </article>
    </Link>
  );
}

// ─── SpaceCardSkeleton ────────────────────────────────────────────────────────

function SpaceCardSkeleton() {
  return (
    <article className="l-pcard">
      <div className="ph">
        <div className="img l-skel" style={{ position: 'absolute', inset: 0 }} />
      </div>
      <div className="body">
        <div className="l-skel" style={{ height: 16, width: '68%', borderRadius: 6, marginBottom: 8 }} />
        <div className="l-skel" style={{ height: 12, width: '48%', borderRadius: 6, marginBottom: 8 }} />
        <div className="l-skel" style={{ height: 14, width: '38%', borderRadius: 6 }} />
      </div>
    </article>
  );
}

// ─── ServiceCard ──────────────────────────────────────────────────────────────

function ServiceCard({ item }: { item: ServiceItem }) {
  const [saved, setSaved] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const pc = phClass(item.title);

  return (
    <Link href={item.href} className="l-pcard" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
      <div className="ph">
        <div className={`img ${pc}`}>
          <div className="l-ph-glyph"><Wrench size={46} /></div>
          {!imgErr && (
            <img src={item.img} alt={item.title} onError={() => setImgErr(true)} />
          )}
        </div>
        {item.badge && <span className="badge">{item.badge}</span>}
        <button
          className="heart"
          onClick={(e) => { e.preventDefault(); setSaved((v) => !v); }}
          aria-label={saved ? 'Remove from wishlist' : 'Save'}
        >
          <Heart size={14} fill={saved ? '#e74c3c' : 'none'} stroke={saved ? '#e74c3c' : 'currentColor'} />
        </button>
      </div>
      <div className="body">
        <div className="r1">
          <div className="ttl">{item.title}</div>
        </div>
        <div className="loc">{item.meta}</div>
        <div className="price">{item.price === 'Free quote' ? item.price : <>From {item.price}</>} <small>{item.per}</small></div>
      </div>
    </Link>
  );
}

// ─── CategoryRail ─────────────────────────────────────────────────────────────

function CategoryRail({
  title,
  blurb,
  href,
  children,
}: {
  title: string;
  blurb: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ paddingTop: 28, paddingBottom: 28 }}>
      <div className="l-wrap">
        <div className="l-sec-head">
          <div>
            <div className="t">{title}</div>
            <div className="s">{blurb}</div>
          </div>
          <Link href={href} className="l-viewall">
            View all {title.toLowerCase()} <ArrowRight size={14} />
          </Link>
        </div>
        <div className="l-rail">
          {children}
        </div>
      </div>
    </section>
  );
}

// ─── Location autocomplete + budget filter ────────────────────────────────────

interface EmirateOption { id: number; nameEn: string; slug: string; }
interface LocationSuggestion {
  label: string;
  type: 'emirate' | 'community';
  communityName: string | null;
  emirateSlug: string;
  emirateName: string;
}
interface BudgetRange { label: string; min: string; max: string; }

const BUDGET_BRACKETS: BudgetRange[] = [
  { label: 'Any budget',          min: '',       max: ''       },
  { label: 'Up to AED 30K/yr',   min: '',       max: '30000'  },
  { label: 'AED 30K – 60K/yr',   min: '30000',  max: '60000'  },
  { label: 'AED 60K – 120K/yr',  min: '60000',  max: '120000' },
  { label: 'AED 120K – 250K/yr', min: '120000', max: '250000' },
  { label: 'AED 250K – 500K/yr', min: '250000', max: '500000' },
  { label: 'AED 500K+/yr',       min: '500000', max: ''       },
];

interface WhenOption { label: string; value: string; }

const WHEN_OPTIONS: WhenOption[] = [
  { label: 'Anytime',      value: ''             },
  { label: 'Today',        value: 'today'        },
  { label: 'Tomorrow',     value: 'tomorrow'     },
  { label: 'This week',    value: 'this_week'    },
  { label: 'This weekend', value: 'this_weekend' },
  { label: 'Next week',    value: 'next_week'    },
];

// ─── HERO ─────────────────────────────────────────────────────────────────────

function Hero({
  mode,
  setMode,
  activeCat,
  setActiveCat,
  serviceCatDefs,
}: {
  mode: 'services' | 'spaces';
  setMode: (m: 'services' | 'spaces') => void;
  activeCat: string;
  setActiveCat: (c: string) => void;
  serviceCatDefs: { id: string; label: string }[];
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLDivElement>(null);

  const [locationText, setLocationText] = useState('');
  const [locationSel, setLocationSel] = useState<LocationSuggestion | null>(null);
  const [locOpen, setLocOpen] = useState(false);
  const [budgetSel, setBudgetSel] = useState<BudgetRange>(BUDGET_BRACKETS[0]);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [whenSel, setWhenSel] = useState<WhenOption>(WHEN_OPTIONS[0]);
  const [whenOpen, setWhenOpen] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);

  useEffect(() => { setLocOpen(false); setBudgetOpen(false); setWhenOpen(false); }, [mode]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!searchRef.current?.contains(e.target as Node)) {
        setLocOpen(false);
        setBudgetOpen(false);
        setWhenOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Lazy — load location suggestions on first focus/type of the search box.
  // Previously this ran on mount, firing 8 calls (emirates + per-emirate
  // communities) on every landing visit even when nobody searched.
  const suggestionsLoaded = useRef(false);
  const loadLocationSuggestions = async () => {
    if (suggestionsLoaded.current) return;
    suggestionsLoaded.current = true;
    // Same-origin proxy (/api) — never an absolute backend URL (avoids CORS).
    const API = '/api';
    try {
      const emirates: EmirateOption[] = await fetch(`${API}/locations/emirates`)
        .then(r => r.ok ? r.json() : []);

      const emirateSuggestions: LocationSuggestion[] = emirates.map(em => ({
        label: em.nameEn,
        type: 'emirate' as const,
        communityName: null,
        emirateSlug: em.slug,
        emirateName: em.nameEn,
      }));

      const communityLists: { nameEn: string }[][] = await Promise.all(
        emirates.map(em =>
          fetch(`${API}/locations/emirates/${em.id}/communities`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      );

      const commSuggestions: LocationSuggestion[] = [];
      communityLists.forEach((communities, i) => {
        const em = emirates[i];
        communities.forEach(c => {
          commSuggestions.push({
            label: `${c.nameEn}, ${em.nameEn}`,
            type: 'community',
            communityName: c.nameEn,
            emirateSlug: em.slug,
            emirateName: em.nameEn,
          });
        });
      });

      setLocationSuggestions([...emirateSuggestions, ...commSuggestions]);
    } catch {
      suggestionsLoaded.current = false; // allow a retry on the next focus
    }
  };

  const locFiltered = locationText.trim().length >= 1
    ? locationSuggestions
        .filter(s => s.label.toLowerCase().includes(locationText.toLowerCase()))
        .slice(0, 7)
    : [];

  const handleSearch = () => {
    const params = new URLSearchParams();
    let base = mode === 'spaces' ? '/listings' : '/services';

    if (mode === 'spaces') {
      if (locationSel?.emirateSlug) {
        base = `/listings/ae/${locationSel.emirateSlug}`;
        if (locationSel.communityName) params.set('q', locationSel.communityName);
      } else if (locationText.trim()) {
        params.set('q', locationText.trim());
      }
      if (budgetSel.min) params.set('minPrice', budgetSel.min);
      if (budgetSel.max) params.set('maxPrice', budgetSel.max);
    } else {
      if (locationText.trim()) params.set('location', locationText.trim());
      if (whenSel.value) params.set('when', whenSel.value);
    }

    router.push(`${base}${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const cats: { id: string; label: string }[] = mode === 'spaces' ? SPACE_CAT_DEFS : serviceCatDefs;
  const catIcons = mode === 'spaces' ? SPACE_CAT_ICONS : SERVICE_CAT_ICONS;
  const allLabel = `All ${mode === 'spaces' ? 'spaces' : 'services'}`;

  return (
    <section className="l-hero" id="top">
      <div className="l-hero-inner">
        {/* Headline */}
        <h1 className="l-hero-line">
          {mode === 'services' ? 'Book trusted services near you.' : 'Find your next space near you.'}
        </h1>

        {/* Segment toggle */}
        <div className="l-segwrap">
          <button
            className={`l-seg${mode === 'services' ? ' active' : ''}`}
            onClick={() => setMode('services')}
          >
            <span className="si"><Wrench size={16} /></span>
            Book a Service
          </button>
          <button
            className={`l-seg${mode === 'spaces' ? ' active' : ''}`}
            onClick={() => setMode('spaces')}
          >
            <span className="si"><Building2 size={16} /></span>
            Find a Space
          </button>
        </div>

        {/* Search bar + dropdowns rendered outside the pill to avoid overflow:hidden clipping */}
        <div ref={searchRef} style={{ position: 'relative', maxWidth: 880, margin: '20px auto 0', width: '100%' }}>
          <div className="l-search" style={{ margin: 0 }}>
            {/* Location field */}
            <div className="field">
              <div className="lbl">Location</div>
              <input
                type="text"
                placeholder={mode === 'spaces' ? 'Area, community or emirate' : 'Your area'}
                value={locationText}
                autoComplete="off"
                onChange={e => {
                  loadLocationSuggestions();
                  setLocationText(e.target.value);
                  setLocationSel(null);
                  setLocOpen(true);
                  setBudgetOpen(false);
                }}
                onFocus={() => { loadLocationSuggestions(); if (locationText.trim()) setLocOpen(true); }}
                onKeyDown={e => {
                  if (e.key === 'Escape') setLocOpen(false);
                  if (e.key === 'Enter') { setLocOpen(false); handleSearch(); }
                }}
              />
            </div>

            {/* Budget / When field — both are dropdown selectors */}
            <div
              className="field"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setLocOpen(false);
                if (mode === 'spaces') { setBudgetOpen(v => !v); setWhenOpen(false); }
                else { setWhenOpen(v => !v); setBudgetOpen(false); }
              }}
            >
              <div className="lbl">{mode === 'spaces' ? 'Budget' : 'When'}</div>
              {mode === 'spaces' ? (
                <div className="l-budget-display">
                  <span style={{ color: budgetSel.min === '' && budgetSel.max === '' ? '#6b7a74' : '#0e1a16' }}>
                    {budgetSel.label}
                  </span>
                  <ChevronDown size={13} style={{ color: '#9ca3af', flexShrink: 0 }} />
                </div>
              ) : (
                <div className="l-budget-display">
                  <span style={{ color: whenSel.value === '' ? '#6b7a74' : '#0e1a16' }}>
                    {whenSel.label}
                  </span>
                  <ChevronDown size={13} style={{ color: '#9ca3af', flexShrink: 0 }} />
                </div>
              )}
            </div>

            <button className="go" onClick={handleSearch} aria-label="Search">
              <Search size={18} />
              <span className="gtxt">Search</span>
            </button>
          </div>

          {/* Location suggestions dropdown */}
          {locOpen && locFiltered.length > 0 && (
            <div className="loc-dropdown loc-dropdown--left">
              {locFiltered.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="loc-option"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setLocationText(s.label); setLocationSel(s); setLocOpen(false); }}
                >
                  <MapPin size={13} className="loc-pin" />
                  <span>
                    <span className="loc-name">{s.communityName ?? s.emirateName}</span>
                    {s.communityName && <span className="loc-sub">, {s.emirateName}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Budget range dropdown */}
          {budgetOpen && (
            <div className="loc-dropdown loc-dropdown--right">
              {BUDGET_BRACKETS.map((b, i) => (
                <button
                  key={i}
                  type="button"
                  className={`loc-option${budgetSel.label === b.label ? ' sel' : ''}`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setBudgetSel(b); setBudgetOpen(false); }}
                >
                  <span>{b.label}</span>
                  {budgetSel.label === b.label && (
                    <Check size={13} style={{ marginLeft: 'auto', color: '#2e9f82', flexShrink: 0 }} />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* When dropdown */}
          {whenOpen && (
            <div className="loc-dropdown loc-dropdown--right">
              {WHEN_OPTIONS.map((w, i) => (
                <button
                  key={i}
                  type="button"
                  className={`loc-option${whenSel.label === w.label ? ' sel' : ''}`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setWhenSel(w); setWhenOpen(false); }}
                >
                  <span>{w.label}</span>
                  {whenSel.label === w.label && (
                    <Check size={13} style={{ marginLeft: 'auto', color: '#2e9f82', flexShrink: 0 }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Category chip row */}
        <div className="l-chiprow">
          <button
            className={`l-catchip${activeCat === 'all' ? ' active' : ''}`}
            onClick={() => setActiveCat('all')}
          >
            <span className="ci"><Grid3X3 size={16} /></span>
            {allLabel}
          </button>
          {cats.map((cat) => (
            <button
              key={cat.id}
              className={`l-catchip${activeCat === cat.id ? ' active' : ''}`}
              onClick={() => setActiveCat(cat.id)}
            >
              <span className="ci">{catIcons[cat.id]}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export function LandingPageV2() {
  const [mode, setMode] = useState<'services' | 'spaces'>('services');
  const [activeCat, setActiveCat] = useState<string>('all');
  const [serviceCats, setServiceCats] = useState<ServiceCat[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  useEffect(() => {
    fetch('/api/catalog/public')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { categories?: PublicCatalogCategory[] }) => setServiceCats(toServiceCats(d.categories ?? [])))
      .catch(() => setServiceCats([]))
      .finally(() => setServicesLoading(false));
  }, []);
  const [spaceCats, setSpaceCats] = useState<SpaceCat[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);

  useEffect(() => {
    Promise.all(
      SPACE_CAT_DEFS.map((def) =>
        fetch(`/api/listings/units?category=${def.id}&limit=4`)
          .then((r) => r.json())
          .then((data: { items: ListingItem[] }) => ({
            ...def,
            items: (data.items ?? []).map(mapToSpaceItem),
          }))
          .catch(() => ({ ...def, items: [] as SpaceItem[] })),
      ),
    )
      .then((cats) => setSpaceCats(cats.filter((c) => c.items.length > 0)))
      .finally(() => setSpacesLoading(false));
  }, []);

  const handleSetMode = (m: 'services' | 'spaces') => {
    setMode(m);
    setActiveCat('all');
  };

  const visibleSpaceCats = activeCat === 'all' ? spaceCats : spaceCats.filter((c) => c.id === activeCat);
  const visibleServiceCats = activeCat === 'all' ? serviceCats : serviceCats.filter((c) => c.id === activeCat);

  return (
    <>
      <SiteHeader />

      <main>
        <Hero
          mode={mode}
          setMode={handleSetMode}
          activeCat={activeCat}
          setActiveCat={setActiveCat}
          serviceCatDefs={serviceCats.map((c) => ({ id: c.id, label: c.label }))}
        />

        {/* Category rails */}
        <div style={{ backgroundColor: 'white' }}>
          {mode === 'spaces'
            ? spacesLoading
              ? SPACE_CAT_DEFS.map((def) => (
                  <CategoryRail key={def.id} title={def.label} blurb={def.blurb} href={def.href}>
                    {Array.from({ length: 4 }).map((_, i) => <SpaceCardSkeleton key={i} />)}
                  </CategoryRail>
                ))
              : visibleSpaceCats.map((cat) => (
                  <CategoryRail key={cat.id} title={cat.label} blurb={cat.blurb} href={cat.href}>
                    {cat.items.map((item) => (
                      <SpaceCard key={item.id ?? item.title} item={item} />
                    ))}
                  </CategoryRail>
                ))
            : servicesLoading
              ? Array.from({ length: 3 }).map((_, r) => (
                  <CategoryRail key={r} title="Loading…" blurb="" href="/services">
                    {Array.from({ length: 4 }).map((_, i) => <SpaceCardSkeleton key={i} />)}
                  </CategoryRail>
                ))
              : visibleServiceCats.map((cat) => (
                <CategoryRail key={cat.id} title={cat.label} blurb={cat.blurb} href={cat.href}>
                  {cat.items.map((item) => (
                    <ServiceCard key={item.title} item={item} />
                  ))}
                </CategoryRail>
              ))}
        </div>
      </main>

      <Footer />
    </>
  );
}
