/**
 * Public services browse — the LISTINGS layout applied to services, for a
 * consistent design across the marketplace (/listings ⇄ /services):
 * lst-hero (breadcrumb + title + search) → category chips (l-catchip) →
 * flat lcard grid. Data comes exclusively from GET /api/catalog/public —
 * the admin console is the single source of truth; no hardcoded taxonomy.
 * Filters work: category chips + text search + ?category=<code> deep links
 * (used by the landing rails).
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Sparkles, Wind, Droplets, Zap, Hammer, PaintRoller, Bug, Car, Trees,
  Building2, Wrench, Loader2, Search, X, LayoutGrid, AlarmClockCheck, Clock,
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
}
interface PublicCategory {
  id: number; code: string; name: string; iconKey: string | null; services: PublicService[];
}

/* ── Category icons (admin icon_key → lucide) ──────────────────────────────── */
const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
  sparkles: Sparkles, wind: Wind, droplets: Droplets, zap: Zap, hammer: Hammer,
  'paint-roller': PaintRoller, bug: Bug, car: Car, trees: Trees, 'building-2': Building2,
};

const FOR_BUSINESS_CODE = 'commercial_services';

/* ── Category imagery — RELEVANT per category, only photo ids already proven
      in this codebase. Same pools as the landing rails (keep the two in sync).
      Cards fall back to a plain tinted panel if a photo ever fails. ────────── */
const UPH = 'https://images.unsplash.com/photo-';
const UQ = '?auto=format&fit=crop&w=800&q=60';
const CATEGORY_IMGS: Record<string, string[]> = {
  home_cleaning:       ['1581578731548-c64695cc6952', '1563453392212-326f5e854473', '1628177142898-93e36e4e3a50', '1584622650111-993a426fbf0a'],
  ac_services:         ['1590756254933-2873d72a83b6', '1621905251918-48416bd8575a'],
  plumbing:            ['1607472586893-edb57bdc0e39', '1585704032915-c3400ca199e7'],
  electrical:          ['1621905252507-b35492cc74b4', '1544724569-5f546fd6f2b5', '1555963966-b7ae5404b6ed'],
  handyman:            ['1504148455328-c376907d081c', '1530124566582-a618bc2615dc', '1426927308491-6380b6a9936f'],
  painting:            ['1562259949-e8e7689d7828', '1717281234297-3def5ae3eee1'],
  pest_control:        ['1687749927928-96276b1d0cb9'],
  car_vehicle:         ['1520340356584-f9917d1eea6f', '1607860108855-64acf2078ed9', '1601362840469-51e4d8d58785'],
  landscaping_outdoor: ['1416879595882-3373a0480b5b', '1558904541-efa843a96f01'],
  commercial_services: ['1497366216548-37526070297c', '1497366811353-6870744d04b2', '1558882224-dda166733046'],
};
const catImg = (code: string, i: number) => {
  const pool = CATEGORY_IMGS[code] ?? CATEGORY_IMGS.home_cleaning;
  return `${UPH}${pool[i % pool.length]}${UQ}`;
};

const fmtAed = (n: number) => n.toLocaleString('en-AE');
function durLabel(min: number | null, max: number | null): string | null {
  if (!min) return null;
  const f = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`);
  return max && max !== min ? `${f(min)}–${f(max)}` : f(min);
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
          <img src={catImg(catCode, idx)} alt={s.name} loading="lazy" onError={() => setImgErr(true)} />
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

/* ── Page body ─────────────────────────────────────────────────────────────── */
export default function ServicesCatalogClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [activeCat, setActiveCat] = useState<string>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/catalog/public')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { categories?: PublicCategory[] }) => setCategories(d.categories ?? []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // Deep links: ?category=<code> (landing rails) and legacy #cat-<code>.
  useEffect(() => {
    const param = searchParams.get('category');
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#cat-', '') : '';
    const target = param || hash;
    if (target) setActiveCat(target);
  }, [searchParams]);

  const consumerCats = useMemo(
    () => categories.filter((c) => c.code !== FOR_BUSINESS_CODE && c.services.length > 0),
    [categories],
  );
  const business = useMemo(() => categories.find((c) => c.code === FOR_BUSINESS_CODE), [categories]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = consumerCats
      .filter((c) => activeCat === 'all' || c.code === activeCat)
      .flatMap((c) => c.services.map((s, i) => ({ s, catName: c.name, catCode: c.code, idx: i })));
    if (!needle) return pool;
    return pool.filter(({ s, catName }) =>
      `${s.name} ${s.description ?? ''} ${catName}`.toLowerCase().includes(needle));
  }, [consumerCats, activeCat, q]);

  const selectCat = (code: string) => {
    setActiveCat(code);
    router.replace(code === 'all' ? '/services' : `/services?category=${code}`, { scroll: false });
  };

  return (
    <>
      {/* ── Hero — same pattern as /listings ── */}
      <section className="lst-hero">
        <div className="l-wrap">
          <nav className="crumb">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Link href="/">Home</Link>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span className="sep">/</span>
              <span className="here">Services</span>
            </span>
          </nav>
          <div className="lst-head">
            <h1>Home &amp; business services in Dubai</h1>
          </div>
          {/* Search */}
          <div style={{ position: 'relative', maxWidth: 560, marginTop: 18 }}>
            <Search size={17} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--mute)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search services — AC cleaning, leak repair, deep cleaning…"
              style={{
                width: '100%', padding: '14px 44px 14px 44px', fontSize: 15,
                border: '1px solid var(--line)', borderRadius: 14, background: '#fff',
                outline: 'none', boxShadow: '0 2px 10px -4px rgba(0,0,0,0.08)',
              }}
            />
            {q && (
              <button type="button" onClick={() => setQ('')}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Body ── */}
      <section className="lst-body" style={{ paddingBlock: 22 }}>
        <div className="l-wrap">
          {/* Category chips — the working filter */}
          <div className="l-chiprow" style={{ marginBottom: 18 }}>
            <button type="button" onClick={() => selectCat('all')} className={`l-catchip${activeCat === 'all' ? ' active' : ''}`}>
              <span className="ci"><LayoutGrid size={15} /></span> All services
            </button>
            {consumerCats.map((c) => {
              const Icon = CATEGORY_ICONS[c.iconKey ?? ''] ?? Wrench;
              return (
                <button key={c.id} type="button" onClick={() => selectCat(c.code)}
                  className={`l-catchip${activeCat === c.code ? ' active' : ''}`}>
                  <span className="ci"><Icon size={15} /></span> {c.name}
                </button>
              );
            })}
          </div>

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
              <h3>No services match your search</h3>
              <p>Try a different word, or clear the category filter.</p>
              <button type="button" onClick={() => { setQ(''); selectCat('all'); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 999, background: '#2e9f82', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', marginTop: 4 }}>
                Reset filters
              </button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13.5, color: 'var(--mute)', margin: '0 0 14px' }}>
                {results.length} service{results.length === 1 ? '' : 's'}
                {activeCat !== 'all' ? ` in ${consumerCats.find((c) => c.code === activeCat)?.name ?? ''}` : ''}
                {q.trim() ? ` matching “${q.trim()}”` : ''}
              </p>
              <div className="lst-results">
                {results.map(({ s, catName, catCode, idx }) => (
                  <ServiceLCard key={s.id} s={s} catName={catName} catCode={catCode} idx={idx} />
                ))}
              </div>
            </>
          )}

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
    </>
  );
}
