/**
 * Public services browse — full mirror of the /listings layout so the two
 * marketplaces feel identical: Navbar → lst-hero (breadcrumb + search bar) →
 * rbar (count + sort) → active filter pills → lst-cols (filter sidebar +
 * lcard grid) → mobile filter drawer.
 *
 * Data comes exclusively from GET /api/catalog/public — the admin console is
 * the single source of truth; no hardcoded taxonomy. All filters are
 * URL-driven (?category=&q=&sort=&pricing=&priceMax=&emergency=&packages=)
 * so results are shareable deep links, same as /listings.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { serviceImg } from '@/lib/serviceImages';
import { Navbar } from '@/components/upnow/Navbar';
import {
  Sparkles, Wind, Droplets, Zap, Hammer, PaintRoller, Bug, Car, Trees,
  Building2, Wrench, Loader2, Search, X, LayoutGrid, AlarmClockCheck, Clock,
  ChevronDown, SlidersHorizontal,
} from 'lucide-react';

/* ── Shapes (GET /api/catalog/public) ──────────────────────────────────────── */
interface PublicPackage {
  id: number; code: string; name: string; basePrice: number | null;
  estimatedDuration: number | null; estimatedDurationMax: number | null;
}
interface PublicAddon { id: number; code: string; name: string; price: number; priceUnit: string }
interface PublicService {
  id: number; code: string; name: string; description: string | null;
  priceUnit: string; pricingMode: string; basePrice: number | null; isFromPrice: boolean;
  minCalloutCharge: number | null; isEmergency: boolean;
  estimatedDuration: number | null; estimatedDurationMax: number | null;
  packageGroupLabel: string | null;
  quantityLabel: string | null; quantityMin: number; quantityMax: number | null;
  addons: PublicAddon[];
  packages: PublicPackage[];
  imageUrl?: string | null;
}
interface PublicCategory {
  id: number; code: string; name: string; iconKey: string | null;
  imageUrl?: string | null; services: PublicService[];
}

/* ── Category icons (admin icon_key → lucide) ──────────────────────────────── */
const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
  sparkles: Sparkles, wind: Wind, droplets: Droplets, zap: Zap, hammer: Hammer,
  'paint-roller': PaintRoller, bug: Bug, car: Car, trees: Trees, 'building-2': Building2,
};

const FOR_BUSINESS_CODE = 'commercial_services';
const PRICE_CAPS = [100, 250, 500, 1000];

const fmtAed = (n: number) => n.toLocaleString('en-AE');
function durLabel(min: number | null, max: number | null): string | null {
  if (!min) return null;
  const f = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`);
  return max && max !== min ? `${f(min)}–${f(max)}` : f(min);
}

/* Filter state — read straight from the URL, same philosophy as /listings. */
interface Filters {
  category: string; q: string; sort: string;
  pricing: string;            // '' | 'fixed' | 'quote'
  priceMax: string;           // '' | number
  emergency: string;          // '' | '1'
  packages: string;           // '' | '1'
}

function CheckSVG() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  );
}

/* ── Service card — the /listings lcard, adapted to services ──────────────── */
function ServiceLCard({ s, catName, catCode, idx }: {
  s: PublicService; catName: string; catCode: string; idx: number;
}) {
  const [imgErr, setImgErr] = useState(false);
  const isQuote = s.pricingMode === 'quote';
  const dur = durLabel(s.estimatedDuration, s.estimatedDurationMax);
  const pkgChips = s.packages.slice(0, 3);
  return (
    <Link href={`/services/book/${s.code}`} className="lcard">
      <div className="ph">
        {!imgErr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={serviceImg(s.code, catCode, idx, s.imageUrl)} alt={s.name} loading="lazy" onError={() => setImgErr(true)} />
        )}
        <span className="cbadge">{catName}</span>
        {s.isEmergency && (
          <span className="feat-tag"><AlarmClockCheck size={12} /> 24/7</span>
        )}
      </div>
      <div className="body">
        <div className="r1">
          <div className="ttl">{s.name}</div>
          {dur && (
            <span className="rate" style={{ fontWeight: 600, color: 'var(--mute)' }}>
              <Clock size={12} style={{ marginRight: 3 }} /> {dur}
            </span>
          )}
        </div>
        <div className="loc">
          <span>{s.description ?? 'Vetted, licensed providers'}</span>
        </div>
        {(pkgChips.length > 0 || s.quantityLabel || s.addons.length > 0) && (
          <div className="amens">
            {pkgChips.map((p) => <span key={p.id} className="amchip">{p.name}</span>)}
            {s.packages.length > 3 && <span className="amchip more">+{s.packages.length - 3} more</span>}
            {s.quantityLabel && <span className="amchip">By {s.quantityLabel.toLowerCase()}</span>}
            {s.addons.length > 0 && <span className="amchip">{s.addons.length} extra{s.addons.length > 1 ? 's' : ''}</span>}
          </div>
        )}
        <div className="price">
          <span className="amt">
            {isQuote || s.basePrice == null
              ? 'Free quote'
              : <>{s.isFromPrice ? 'From ' : ''}AED {fmtAed(Number(s.basePrice))}<small>{s.priceUnit === 'per_hour' ? '/hour' : ''}</small></>}
          </span>
          <span className="ut">{isQuote ? 'pay after approval' : 'VAT included'}</span>
        </div>
      </div>
    </Link>
  );
}

/* ── Filter sidebar — same fcard/fgroup vocabulary as /listings ────────────── */
function ServiceFilterSidebar({ f, cats, counts, navigate, onClose }: {
  f: Filters;
  cats: PublicCategory[];
  counts: Record<string, number>;
  navigate: (overrides: Partial<Filters>) => void;
  onClose?: () => void;
}) {
  const go = (overrides: Partial<Filters>) => { navigate(overrides); onClose?.(); };
  return (
    <div className="fcard">
      {/* Category */}
      <div className="fgroup">
        <span className="flabel">Category</span>
        <div className="catlist">
          <button className={`catrow${f.category === '' ? ' active' : ''}`} onClick={() => go({ category: '' })}>
            <span className="ci"><LayoutGrid size={16} /></span>
            All services
            {counts.all != null && <span className="cn">{counts.all}</span>}
          </button>
          {cats.map((c) => {
            const Icon = CATEGORY_ICONS[c.iconKey ?? ''] ?? Wrench;
            return (
              <button key={c.id} className={`catrow${f.category === c.code ? ' active' : ''}`}
                onClick={() => go({ category: c.code })}>
                <span className="ci"><Icon size={16} /></span>
                {c.name}
                {counts[c.code] != null && <span className="cn">{counts[c.code]}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pricing type */}
      <div className="fgroup">
        <span className="flabel">Pricing</span>
        <div className="bedrow">
          {[{ v: '', l: 'Any' }, { v: 'fixed', l: 'Fixed price' }, { v: 'quote', l: 'Free quote' }].map(({ v, l }) => (
            <button key={v || 'any'} className={`bedpill${f.pricing === v ? ' on' : ''}`}
              onClick={() => go({ pricing: v, ...(v === 'quote' ? { priceMax: '' } : {}) })}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Max price */}
      <div className="fgroup">
        <span className="flabel">Max price <span className="muted">· AED</span></span>
        <div className="bedrow">
          <button className={`bedpill${f.priceMax === '' ? ' on' : ''}`} onClick={() => go({ priceMax: '' })}>Any</button>
          {PRICE_CAPS.map((cap) => (
            <button key={cap} className={`bedpill${f.priceMax === String(cap) ? ' on' : ''}`}
              onClick={() => go({ priceMax: String(cap), pricing: f.pricing === 'quote' ? '' : f.pricing })}>
              ≤ {cap}
            </button>
          ))}
        </div>
      </div>

      {/* Only show */}
      <div className="fgroup">
        <span className="flabel">Only show</span>
        <div className="checklist">
          <label className={`checkrow${f.emergency ? ' on' : ''}`} onClick={() => go({ emergency: f.emergency ? '' : '1' })}>
            <span className="box">{f.emergency && <CheckSVG />}</span>
            24/7 emergency
          </label>
          <label className={`checkrow${f.packages ? ' on' : ''}`} onClick={() => go({ packages: f.packages ? '' : '1' })}>
            <span className="box">{f.packages && <CheckSVG />}</span>
            With size / type packages
          </label>
        </div>
      </div>

      <div className="fgroup">
        <button className="fclear" onClick={() => go({ category: '', q: '', pricing: '', priceMax: '', emergency: '', packages: '' })}>
          Reset all filters
        </button>
      </div>
    </div>
  );
}

/* ── Page body ─────────────────────────────────────────────────────────────── */
export default function ServicesCatalogClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  /* URL is the single source of truth for every filter (listings pattern). */
  const f: Filters = {
    category: sp.get('category') ?? '',
    q: sp.get('q') ?? '',
    sort: sp.get('sort') ?? 'recommended',
    pricing: sp.get('pricing') ?? '',
    priceMax: sp.get('priceMax') ?? '',
    emergency: sp.get('emergency') ?? '',
    packages: sp.get('packages') ?? '',
  };
  const [inputQ, setInputQ] = useState(f.q);
  useEffect(() => { setInputQ(f.q); }, [f.q]);

  const navigate = (overrides: Partial<Filters>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if ((overrides.sort ?? f.sort) === 'recommended') next.delete('sort');
    const qs = next.toString();
    router.replace(`/services${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  useEffect(() => {
    fetch('/api/catalog/public')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { categories?: PublicCategory[] }) => setCategories(d.categories ?? []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // Legacy #cat-<code> anchors → ?category=<code>
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#cat-', '') : '';
    if (hash) {
      window.location.hash = '';
      navigate({ category: hash });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const consumerCats = useMemo(
    () => categories.filter((c) => c.code !== FOR_BUSINESS_CODE && c.services.length > 0),
    [categories],
  );
  const business = useMemo(() => categories.find((c) => c.code === FOR_BUSINESS_CODE), [categories]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: 0 };
    for (const c of consumerCats) { m[c.code] = c.services.length; m.all += c.services.length; }
    return m;
  }, [consumerCats]);

  const results = useMemo(() => {
    const needle = f.q.trim().toLowerCase();
    const cap = f.priceMax ? Number(f.priceMax) : null;
    let pool = consumerCats
      .filter((c) => !f.category || c.code === f.category)
      .flatMap((c) => c.services.map((s, i) => ({ s, catName: c.name, catCode: c.code, idx: i })));

    if (needle) {
      pool = pool.filter(({ s, catName }) =>
        `${s.name} ${s.description ?? ''} ${catName}`.toLowerCase().includes(needle));
    }
    if (f.pricing === 'fixed') pool = pool.filter(({ s }) => s.pricingMode !== 'quote' && s.basePrice != null);
    if (f.pricing === 'quote') pool = pool.filter(({ s }) => s.pricingMode === 'quote' || s.basePrice == null);
    if (cap != null) pool = pool.filter(({ s }) => s.basePrice != null && Number(s.basePrice) <= cap);
    if (f.emergency) pool = pool.filter(({ s }) => s.isEmergency);
    if (f.packages) pool = pool.filter(({ s }) => s.packages.length > 0);

    const byPrice = (x: { s: PublicService }) => (x.s.basePrice == null ? Number.POSITIVE_INFINITY : Number(x.s.basePrice));
    if (f.sort === 'price_asc') pool = [...pool].sort((a, b) => byPrice(a) - byPrice(b));
    else if (f.sort === 'price_desc') pool = [...pool].sort((a, b) => (b.s.basePrice == null ? -1 : Number(b.s.basePrice)) - (a.s.basePrice == null ? -1 : Number(a.s.basePrice)));
    else if (f.sort === 'name') pool = [...pool].sort((a, b) => a.s.name.localeCompare(b.s.name));
    return pool;
  }, [consumerCats, f.category, f.q, f.pricing, f.priceMax, f.emergency, f.packages, f.sort]);

  /* Active pills — mirror of the listings pill row. */
  const pills: { label: string; clear: Partial<Filters> }[] = [];
  if (f.category) {
    const cat = consumerCats.find((c) => c.code === f.category);
    pills.push({ label: cat?.name ?? f.category, clear: { category: '' } });
  }
  if (f.pricing) pills.push({ label: f.pricing === 'fixed' ? 'Fixed price' : 'Free quote', clear: { pricing: '' } });
  if (f.priceMax) pills.push({ label: `≤ AED ${Number(f.priceMax).toLocaleString()}`, clear: { priceMax: '' } });
  if (f.emergency) pills.push({ label: '24/7 emergency', clear: { emergency: '' } });
  if (f.packages) pills.push({ label: 'With packages', clear: { packages: '' } });
  if (f.q) pills.push({ label: `“${f.q}”`, clear: { q: '' } });

  const sidebarProps = { f, cats: consumerCats, counts, navigate };
  const activeCatName = f.category ? consumerCats.find((c) => c.code === f.category)?.name : null;

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      <Navbar />

      {/* ── Hero — same pattern as /listings ── */}
      <section className="lst-hero">
        <div className="l-wrap">
          <nav className="crumb">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Link href="/">Home</Link>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span className="sep">/</span>
              <span className="here">{activeCatName ?? 'Services'}</span>
            </span>
          </nav>
          <div className="lst-head">
            <h1>{activeCatName ? `${activeCatName} services` : 'Services'}</h1>
          </div>

          {/* Search bar — lst-search, mirroring ListingsSearchBar */}
          <div className="lst-search">
            <div className="sfield">
              <Search size={18} />
              <input
                value={inputQ}
                onChange={(e) => { setInputQ(e.target.value); if (e.target.value === '') navigate({ q: '' }); }}
                onKeyDown={(e) => e.key === 'Enter' && navigate({ q: inputQ.trim() })}
                placeholder="Search services — AC cleaning, leak repair, deep cleaning…"
              />
            </div>
            <div className="sdiv" />
            <div className="sselect">
              <select value={f.category} onChange={(e) => navigate({ category: e.target.value })}>
                <option value="">All categories</option>
                {consumerCats.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}
              </select>
              <span className="schev"><ChevronDown size={14} /></span>
            </div>
            <button className="sgo" onClick={() => navigate({ q: inputQ.trim() })}>
              <Search size={14} />
              Search
            </button>
          </div>
        </div>
      </section>

      {/* ── Body ── */}
      <section className="lst-body">
        <div className="l-wrap">
          {/* Results bar */}
          <div className="rbar">
            <p className="found">
              <b>{loading ? '…' : results.length.toLocaleString()}</b> {results.length === 1 ? 'service' : 'services'} available
              {activeCatName ? ` in ${activeCatName}` : ''}
            </p>
            <div className="rtools">
              <button className="mobfilter" onClick={() => setMobileOpen(true)}>
                <SlidersHorizontal size={15} />
                Filters
                {pills.length > 0 && <span className="cnt">{pills.length}</span>}
              </button>
              <div className="sortsel">
                <select value={f.sort} onChange={(e) => navigate({ sort: e.target.value })}>
                  <option value="recommended">Recommended</option>
                  <option value="price_asc">Price: Low → High</option>
                  <option value="price_desc">Price: High → Low</option>
                  <option value="name">Name A → Z</option>
                </select>
                <span className="schev"><ChevronDown size={14} /></span>
              </div>
            </div>
          </div>

          {/* Active pills */}
          {pills.length > 0 && (
            <div className="activepills">
              {pills.map((pill, i) => (
                <span key={i} className="apill">
                  {pill.label}
                  <button onClick={() => navigate(pill.clear)} aria-label="Remove filter"><X size={12} /></button>
                </span>
              ))}
              {pills.length > 1 && (
                <button className="clearall"
                  onClick={() => navigate({ category: '', q: '', pricing: '', priceMax: '', emergency: '', packages: '' })}>
                  Clear all
                </button>
              )}
            </div>
          )}

          {/* Two-column layout — sidebar + results, same as /listings */}
          <div className="lst-cols">
            <aside className="lst-aside">
              <ServiceFilterSidebar {...sidebarProps} />
            </aside>

            <div className="lst-main">
              {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '80px 0', color: 'var(--mute)' }}>
                  <Loader2 size={18} className="animate-spin" /> Loading services…
                </div>
              ) : failed || consumerCats.length === 0 ? (
                <div className="lst-empty">
                  <div className="ei"><Wrench size={26} /></div>
                  <h3>Services are on the way</h3>
                  <p>Our home-services catalog is being prepared. Check back soon.</p>
                </div>
              ) : results.length === 0 ? (
                <div className="lst-empty">
                  <div className="ei"><Search size={26} /></div>
                  <h3>No services match your filters</h3>
                  <p>Try widening your search or clearing a filter.</p>
                  <button type="button"
                    onClick={() => navigate({ category: '', q: '', pricing: '', priceMax: '', emergency: '', packages: '' })}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 999, background: '#2e9f82', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', marginTop: 4 }}>
                    Reset filters
                  </button>
                </div>
              ) : (
                <div className="lst-results">
                  {results.map(({ s, catName, catCode, idx }) => (
                    <ServiceLCard key={s.id} s={s} catName={catName} catCode={catCode} idx={idx} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* For Business band (commercial trio → proposal channel) */}
          {business && business.services.length > 0 && (
            <section className="p-8 mt-10" style={{ background: '#0e1a16', borderRadius: 24 }}>
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div className="min-w-[240px]">
                  <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#9ca3af' }}>
                    <Building2 size={13} /> For Business
                  </p>
                  <h2 className="text-xl font-bold text-white mb-1.5">
                    {business.services.map((s) => s.name).join(' · ')}
                  </h2>
                  <p className="text-sm max-w-xl" style={{ color: '#9ca3af' }}>
                    Offices, buildings and facilities are quoted on inspection with agreed
                    response times. Tell us what you need and we&apos;ll come back with a proposal.
                  </p>
                </div>
                <a
                  href="mailto:business@upnow.ae?subject=Business%20services%20proposal%20request"
                  className="rounded-xl px-5 py-3 text-sm font-semibold flex-shrink-0"
                  style={{ background: '#2e9f82', color: '#fff' }}
                >
                  Request a proposal
                </a>
              </div>
            </section>
          )}
        </div>
      </section>

      {/* ── Mobile drawer — same as /listings ── */}
      {mobileOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setMobileOpen(false)} />
          <div className="drawer open">
            <div className="drawer-head">
              <h3>Filters</h3>
              <button className="dx" onClick={() => setMobileOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="drawer-body">
              <ServiceFilterSidebar {...sidebarProps} onClose={() => setMobileOpen(false)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
