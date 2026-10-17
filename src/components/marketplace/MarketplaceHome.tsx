'use client';

/**
 * Public homepage — the MarketSpace home (upnow-marketspace index.html + js/pages/home.js)
 * rebuilt on real data.
 *
 * - Seven vertical tabs + All. Only Spaces and Services are backed by the API today; the
 *   other five show their declared subcategories as "Coming soon" with no listings
 *   (owner decision, Oct 2026). Within Spaces / Services, subcategories without a backend
 *   binding (courts, yachts, salons, …) are shown but disabled.
 * - Listings come from GET /listings/units and GET /catalog/public. Empty or failed
 *   responses show an empty state — never demo listings.
 * - Search hands off to the existing /listings and /services pages.
 *
 * Tab state lives in the URL (?v=<vertical>&o=<subcategory>) so tabs are linkable.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight, Award, Building2, CalendarCheck, Check, ChevronDown, ChevronRight, Compass, Clock3,
  GraduationCap, LayoutGrid, MapPin, Search, Shield, ShieldCheck, Stethoscope, Wrench, type LucideIcon,
} from 'lucide-react';
import { SiteHeader } from '@/components/upnow/SiteHeader';
import { Footer } from '@/components/upnow/Footer';
import {
  VERTICALS, MAPPED_SERVICE_CODES, bindingOf, isOfferLive, isOfferPreview, isVerticalLive, previewModelOf, verticalOf,
  type MsOffer, type MsVerticalId,
} from '@/lib/catalog';
import { SEED_LISTINGS } from '@/lib/os/bookings/seed';
import type { BookingModel, PreviewListing } from '@/lib/os/bookings/types';
import { MODEL_NOUN, MODEL_ORDER, MODEL_PLURAL, fromPrice, metaLine } from '@/components/booking/format';
import {
  fetchListedAreas, fetchLocationSuggestions, fetchServiceCatalog, fetchUnitCards, serviceCards, unitsSearchHref,
  type LocationSuggestion, type MarketCard, type PublicCatalogCategory,
} from '@/lib/catalog/publicData';
import { BUDGETS, HEADLINES, HERO_IMAGES, STEPS, type HomeTab } from './homeContent';
import './marketplace.css';

const VICON: Record<MsVerticalId, LucideIcon> = {
  spaces: Building2, services: Wrench, experiences: Compass, memberships: Award,
  programs: GraduationCap, health: Stethoscope, insurance: Shield,
};
const RAIL = 6;

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error' };

// ---------------------------------------------------------------------------- cards

function Card({ c }: { c: MarketCard }) {
  // 0 = c.img, 1 = c.fallback (local picture), 2 = icon placeholder only.
  const [stage, setStage] = useState(c.img ? 0 : c.fallback ? 1 : 2);
  const src = stage === 0 ? c.img : stage === 1 ? c.fallback : null;
  return (
    <Link href={c.href} className="mcard">
      <div className="media">
        <Building2 size={34} aria-hidden />
        {src && <img key={src} src={src} alt="" loading="lazy" onError={() => setStage((n) => (n === 0 && c.fallback ? 1 : 2))} />}
        {c.badge && <span className={`badge${c.badge === 'Preview' ? ' is-preview' : ''}`}>{c.badge}</span>}
      </div>
      <div className="t">{c.title}</div>
      <div className="m">{c.meta}</div>
      <div className="p">{c.price} {c.per && <small>{c.per}</small>}</div>
    </Link>
  );
}

/** A PREVIEW listing (browser-only booking engine) as a marketplace card → /book/<id>. */
function previewCard(l: PreviewListing, mixed: boolean): MarketCard {
  const p = fromPrice(l);
  return {
    key: `pv-${l.id}`, title: l.title, meta: mixed ? `${MODEL_NOUN[l.model]} · ${l.area}` : metaLine(l),
    price: p.price, per: p.per, img: l.images[0] ?? null, badge: 'Preview', href: `/book/${l.id}`,
  };
}
const previewCards = (model: BookingModel) => SEED_LISTINGS.filter((l) => l.model === model).map((l) => previewCard(l, false));
const PREVIEW_SUB = 'Preview — demonstration bookings, no real payment is taken';

/** Preview cards interleaved across models (holiday, venue, court, yacht, holiday, …). */
function previewMix(): MarketCard[] {
  const byModel = MODEL_ORDER.map((m) => SEED_LISTINGS.filter((l) => l.model === m));
  const out: MarketCard[] = [];
  for (let i = 0; byModel.some((l) => i < l.length); i++) {
    for (const l of byModel) if (l[i]) out.push(previewCard(l[i], true));
  }
  return out;
}

const SPACE_OFFERS = VERTICALS.find((v) => v.id === 'spaces')!.offers
  .filter((o) => isOfferLive('spaces', o.id) || isOfferPreview('spaces', o.id));
/** "All" chip in the homepage Spaces section: up to this many live units first, then preview. */
const MIX_LIVE = 4;
const MIX_SIZE = RAIL * 2;

type UnitCache = Record<string, Load<MarketCard[]>>;

/**
 * Cards for one Spaces subcategory: live units (GET /listings/units) first, then that
 * subcategory's preview listings (/book). 'all' = a mixed selection, live first.
 */
function spacesLoad(units: UnitCache, sub: string): { load: Load<MarketCard[]>; href: string; hasPreview: boolean } {
  if (sub === 'all') {
    const live = units['spaces.*'] ?? { state: 'loading' as const };
    if (live.state === 'loading') return { load: live, href: '/listings', hasPreview: true };
    const liveCards = live.state === 'ok' ? live.data.slice(0, MIX_LIVE) : [];
    return {
      load: { state: 'ok', data: [...liveCards, ...previewMix()].slice(0, MIX_SIZE) },
      href: '/listings', hasPreview: true,
    };
  }
  const binding = bindingOf('spaces', sub);
  const model = previewModelOf('spaces', sub);
  const pv = model ? previewCards(model) : [];
  const live: Load<MarketCard[]> = binding?.kind === 'units'
    ? units[`spaces.${sub}`] ?? { state: 'loading' }
    : { state: 'ok', data: [] };
  const liveHref = binding?.kind === 'units' ? unitsSearchHref(binding) : null;
  if (live.state === 'loading') return { load: live, href: liveHref ?? '/listings', hasPreview: pv.length > 0 };
  const liveCards = live.state === 'ok' ? live.data : [];
  // A failed live fetch with no preview fallback is reported as an error, not as "empty".
  if (live.state === 'error' && pv.length === 0) return { load: live, href: liveHref ?? '/listings', hasPreview: false };
  const href = liveCards.length > 0 || !model ? (liveHref ?? '/listings') : `/book?model=${model}`;
  return { load: { state: 'ok', data: [...liveCards, ...pv].slice(0, RAIL) }, href, hasPreview: pv.length > 0 };
}

/** "commercial listings", "holiday homes" — a readable plural for a Spaces subcategory label. */
const spacesNoun = (o: { id: string; label: string }) =>
  isOfferPreview('spaces', o.id) ? o.label.toLowerCase() : `${o.label.toLowerCase()} listings`;

/** The single homepage Spaces section: one heading, subcategory chips, one card grid. */
function SpacesSection({ units, sub, onSub }: { units: UnitCache; sub: string; onSub: (s: string) => void }) {
  const offer = SPACE_OFFERS.find((o) => o.id === sub);
  const { load, href, hasPreview } = spacesLoad(units, offer ? sub : 'all');
  const showsPreview = hasPreview && load.state === 'ok' && load.data.some((c) => c.badge === 'Preview');
  return (
    <section className="section">
      <div className="sec-head">
        <div>
          <h2>Spaces</h2>
          <p>Homes, offices, warehouses, land, holiday homes, venues, courts and yachts from verified providers</p>
        </div>
        <Link href={href}>{offer ? `See all ${spacesNoun(offer)}` : 'See all spaces'} <ChevronRight size={16} /></Link>
      </div>
      <div className="sec-chips" role="group" aria-label="Space types">
        <button type="button" className="offer-chip" aria-pressed={!offer} onClick={() => onSub('all')}>All</button>
        {SPACE_OFFERS.map((o) => (
          <button key={o.id} type="button" className="offer-chip" aria-pressed={offer?.id === o.id} onClick={() => onSub(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      {load.state === 'loading' && <SkeletonRow />}
      {load.state === 'error' && <div className="empty"><b>Couldn&apos;t load listings</b>Please refresh the page to try again.</div>}
      {load.state === 'ok' && load.data.length === 0 && (
        <div className="empty"><b>No published {offer ? spacesNoun(offer) : 'spaces'} yet</b>
          New listings appear here as soon as UpNow approves them. <Link href="/listings" style={{ color: 'var(--ms-primary)', fontWeight: 700 }}>Browse all spaces</Link></div>
      )}
      {load.state === 'ok' && load.data.length > 0 && <div className="card-row">{load.data.map((c) => <Card key={c.key} c={c} />)}</div>}
      {showsPreview && <p className="sec-note">Cards tagged <b>Preview</b> are demonstration bookings — no real payment is taken.</p>}
    </section>
  );
}

function SkeletonRow() {
  return (
    <div className="card-row" aria-busy="true" aria-label="Loading listings">
      {Array.from({ length: RAIL }).map((_, i) => (
        <div key={i}>
          <div className="skel" style={{ aspectRatio: '4 / 3', borderRadius: 12 }} />
          <div className="skel" style={{ height: 14, width: '80%', marginTop: 10 }} />
          <div className="skel" style={{ height: 12, width: '55%', marginTop: 6 }} />
        </div>
      ))}
    </div>
  );
}

function Rail({ title, sub, href, cta, load }: {
  title: string; sub?: string; href: string; cta: string; load: Load<MarketCard[]>;
}) {
  if (load.state === 'ok' && load.data.length === 0) return null;
  return (
    <section className="section">
      <div className="sec-head">
        <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
        <Link href={href}>{cta} <ChevronRight size={16} /></Link>
      </div>
      {load.state === 'loading' && <SkeletonRow />}
      {load.state === 'error' && <div className="empty"><b>Couldn&apos;t load listings</b>Please refresh the page to try again.</div>}
      {load.state === 'ok' && <div className="card-row">{load.data.map((c) => <Card key={c.key} c={c} />)}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------- search

function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onOut(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOut]);
}

function SpacesSearch({ offer }: { offer: MsOffer | null }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [sel, setSel] = useState<LocationSuggestion | null>(null);
  const [budget, setBudget] = useState(BUDGETS[0]);
  const [open, setOpen] = useState<'loc' | 'budget' | null>(null);
  const [sugg, setSugg] = useState<LocationSuggestion[]>([]);
  const loaded = useRef(false);
  useOutside(box, () => setOpen(null));

  // Lazy: the emirates + communities lists load on first focus, not on every visit.
  const loadSugg = () => {
    if (loaded.current) return;
    loaded.current = true;
    fetchLocationSuggestions().then(setSugg).catch(() => { loaded.current = false; });
  };
  const matches = text.trim()
    ? sugg.filter((s) => s.label.toLowerCase().includes(text.trim().toLowerCase())).slice(0, 7)
    : [];

  const submit = () => {
    const p = new URLSearchParams();
    const binding = offer ? bindingOf('spaces', offer.id) : null;
    if (sel?.community) p.set('q', sel.community);
    else if (!sel && text.trim()) p.set('q', text.trim());
    if (budget.min) p.set('minPrice', budget.min);
    if (budget.max) p.set('maxPrice', budget.max);
    const base = binding?.kind === 'units' ? unitsSearchHref(binding, p) : `/listings${p.size ? `?${p}` : ''}`;
    // An emirate pick uses the existing /listings/ae/<emirate> route.
    router.push(sel ? base.replace(/^\/listings/, `/listings/ae/${sel.emirateSlug}`) : base);
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <form className="search-bar" onSubmit={(e) => { e.preventDefault(); setOpen(null); submit(); }} role="search">
        <label className={`sfield loc${open === 'loc' ? ' is-open' : ''}`}>
          <span className="flabel">Location</span>
          <span className="loc-input">
            <MapPin size={15} aria-hidden />
            <input
              value={text}
              placeholder="Area, community or emirate"
              autoComplete="off"
              aria-label="Location"
              onFocus={() => { loadSugg(); if (text.trim()) setOpen('loc'); }}
              onChange={(e) => { loadSugg(); setText(e.target.value); setSel(null); setOpen('loc'); }}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(null); }}
            />
          </span>
        </label>
        <div className={`sfield${open === 'budget' ? ' is-open' : ''}`}>
          <button type="button" className="sbtn" aria-haspopup="listbox" aria-expanded={open === 'budget'}
            onClick={() => setOpen((o) => (o === 'budget' ? null : 'budget'))}>
            <span className="flabel">Budget</span>
            <span className={`fvalue${budget.min || budget.max ? '' : ' ph'}`}>{budget.label}</span>
            <ChevronDown size={14} aria-hidden />
          </button>
        </div>
        <button type="submit" className="search-submit"><Search size={18} aria-hidden /> Search</button>
      </form>
      {open === 'loc' && matches.length > 0 && (
        <div className="pop left" role="listbox" aria-label="Locations">
          {matches.map((s) => (
            <button key={s.label} type="button" role="option" aria-selected={false} className="pop-opt"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setText(s.label); setSel(s); setOpen(null); }}>
              <MapPin size={14} aria-hidden />
              <span>{s.community ?? s.emirateName}{s.community && <small>, {s.emirateName}</small>}</span>
            </button>
          ))}
        </div>
      )}
      {open === 'budget' && (
        <div className="pop right" role="listbox" aria-label="Budget">
          {BUDGETS.map((b) => (
            <button key={b.label} type="button" role="option" aria-selected={b.label === budget.label} className="pop-opt"
              onClick={() => { setBudget(b); setOpen(null); }}>
              <span style={{ flex: 1 }}>{b.label}</span>
              {b.label === budget.label && <Check size={14} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ServicesSearch({ offer }: { offer: MsOffer | null }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const submit = () => {
    const p = new URLSearchParams();
    const b = offer ? bindingOf('services', offer.id) : null;
    // /services filters by a single catalog category code.
    if (b?.kind === 'services' && b.categoryCodes.length === 1) p.set('category', b.categoryCodes[0]);
    if (q.trim()) p.set('q', q.trim());
    router.push(`/services${p.size ? `?${p}` : ''}`);
  };
  return (
    <form className="search-bar" role="search" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label className="sfield loc">
        <span className="flabel">{offer ? offer.label : 'Service'}</span>
        <span className="loc-input">
          <Search size={15} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="What do you need?"
            placeholder={offer ? `What do you need? e.g. ${offer.label.toLowerCase()}` : 'What do you need? e.g. AC cleaning'} />
        </span>
      </label>
      <button type="submit" className="search-submit"><Search size={18} aria-hidden /> Search</button>
    </form>
  );
}

// ---------------------------------------------------------------------------- page

export function MarketplaceHome() {
  const router = useRouter();
  const params = useSearchParams();

  const rawV = params.get('v');
  const tab: HomeTab = rawV && verticalOf(rawV) ? (rawV as MsVerticalId) : 'all';
  const vertical = tab === 'all' ? null : verticalOf(tab)!;
  const live = tab !== 'all' && isVerticalLive(tab);
  const offer = useMemo(() => {
    if (!vertical) return null;
    const want = params.get('o');
    return vertical.offers.find((o) => o.id === want && (isOfferLive(vertical.id, o.id) || isOfferPreview(vertical.id, o.id)))
      ?? vertical.offers.find((o) => isOfferLive(vertical.id, o.id)) ?? null;
  }, [vertical, params]);

  const setTab = (v: HomeTab, o?: string) => {
    const p = new URLSearchParams(params.toString());
    if (v === 'all') p.delete('v'); else p.set('v', v);
    if (o) p.set('o', o); else p.delete('o');
    router.replace(p.size ? `/?${p}` : '/', { scroll: false });
  };

  // ---- data (cached per key for the life of the page)
  const [catalog, setCatalog] = useState<Load<PublicCatalogCategory[]>>({ state: 'loading' });
  const [units, setUnits] = useState<UnitCache>({});
  // Selected chip in the All tab's Spaces section (local; the hero chips own ?o= on the Spaces tab).
  const [spaceSub, setSpaceSub] = useState('all');
  const [areas, setAreas] = useState<string[]>([]);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const ac = new AbortController();
    fetchServiceCatalog(ac.signal).then((data) => setCatalog({ state: 'ok', data }))
      .catch((e) => { if (e.name !== 'AbortError') setCatalog({ state: 'error' }); });
    fetchListedAreas(ac.signal).then((a) => setAreas(a.slice(0, 8))).catch(() => {});
    return () => ac.abort();
  }, []);

  const unitKeys = useMemo(() => {
    if (tab === 'all') return spaceSub !== 'all' && isOfferLive('spaces', spaceSub) ? ['spaces.*', `spaces.${spaceSub}`] : ['spaces.*'];
    if (tab === 'spaces') return VERTICALS.find((v) => v.id === 'spaces')!.offers
      .filter((o) => isOfferLive('spaces', o.id)).map((o) => `spaces.${o.id}`);
    return [];
  }, [tab, spaceSub]);

  useEffect(() => {
    for (const key of unitKeys) {
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      const binding = key === 'spaces.*' ? { kind: 'units' as const } : bindingOf('spaces', key.split('.')[1]);
      if (binding?.kind !== 'units') continue;
      fetchUnitCards(binding, RAIL)
        .then(({ cards }) => setUnits((u) => ({ ...u, [key]: { state: 'ok', data: cards } })))
        .catch(() => setUnits((u) => ({ ...u, [key]: { state: 'error' } })));
    }
  }, [unitKeys]);

  const services = (codes: ReadonlySet<string> | null): Load<MarketCard[]> =>
    catalog.state === 'ok' ? { state: 'ok', data: serviceCards(catalog.data, codes, RAIL) } : catalog;
  const unmappedCodes = catalog.state === 'ok'
    ? new Set(catalog.data.map((c) => c.code).filter((c) => !MAPPED_SERVICE_CODES.has(c)))
    : new Set<string>();

  // ---- hero
  const selPreview = tab === 'spaces' ? previewModelOf('spaces', offer?.id) : null;
  const [h1, sub] = HEADLINES[tab];
  const heroImg = HERO_IMAGES[offer?.id ?? (tab === 'all' ? 'all' : vertical!.offers[0].id)] ?? HERO_IMAGES.all;
  const tabs: HomeTab[] = ['all', ...VERTICALS.map((v) => v.id)];

  // ---- rails for the current tab
  let body: React.ReactNode;
  if (tab === 'all') {
    body = (
      <>
        <SpacesSection units={units} sub={spaceSub} onSub={setSpaceSub} />
        <Rail title="Services" sub="Book licensed providers online" href="/services" cta="See all services" load={services(null)} />
        <section className="section">
          <div className="sec-head"><div><h2>Coming soon to UpNow</h2><p>These verticals are being prepared. No listings yet.</p></div></div>
          <div className="soon-grid">
            {VERTICALS.filter((v) => !isVerticalLive(v.id)).map((v) => {
              const Ic = VICON[v.id];
              return (
                <button key={v.id} type="button" className="soon-card" style={{ textAlign: 'left' }} onClick={() => setTab(v.id)}>
                  <div className="media">
                    <img src={HERO_IMAGES[v.offers[0].id] ?? HERO_IMAGES.all} alt="" loading="lazy" />
                    <span className="soon-tag">Coming soon</span>
                  </div>
                  <div className="b"><b><Ic size={14} aria-hidden style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />{v.label}</b>
                    <span>{v.offers.map((o) => o.label).join(' · ')}</span></div>
                </button>
              );
            })}
          </div>
        </section>
      </>
    );
  } else if (!live) {
    body = (
      <section className="section">
        <div className="sec-head"><div><h2>{vertical!.label} on UpNow</h2><p>{vertical!.offers.length} categories planned. Listings open once providers can be verified for this vertical.</p></div></div>
        <div className="soon-grid">
          {vertical!.offers.map((o) => (
            <div key={o.id} className="soon-card">
              <div className="media">
                {HERO_IMAGES[o.id] ? <img src={HERO_IMAGES[o.id]} alt="" loading="lazy" /> : null}
                <span className="soon-tag">Coming soon</span>
              </div>
              <div className="b"><b>{o.label}</b><span>{o.basis}</span>{o.providerTypes[0] && <span>{o.providerTypes[0]}</span>}</div>
            </div>
          ))}
        </div>
      </section>
    );
  } else if (tab === 'spaces') {
    // One rail per subcategory (MarketSpace layout): live units first, then that subcategory's
    // preview listings — never a second rail for the same subcategory. Selected subcategory first;
    // it shows an empty state when it has nothing, the others are left out when empty.
    const ordered = [...SPACE_OFFERS].sort((a, b) => Number(b.id === offer?.id) - Number(a.id === offer?.id));
    body = (
      <>
        {ordered.map((o) => {
          const { load, href, hasPreview } = spacesLoad(units, o.id);
          const selected = o.id === offer?.id;
          if (selected && load.state === 'ok' && load.data.length === 0) {
            return (
              <section key={o.id} className="section">
                <div className="sec-head"><div><h2>{o.h1}</h2>{o.basis && <p>{o.basis} · verified providers</p>}</div></div>
                <div className="empty"><b>No published {spacesNoun(o)} yet</b>
                  New listings appear here as soon as UpNow approves them.</div>
              </section>
            );
          }
          const onlyPreview = load.state === 'ok' && load.data.length > 0 && load.data.every((c) => c.badge === 'Preview');
          const sub = onlyPreview ? PREVIEW_SUB
            : `${o.basis ? `${o.basis} · ` : ''}verified providers${hasPreview && load.state === 'ok' && load.data.some((c) => c.badge === 'Preview') ? ' · Preview cards are demonstration bookings' : ''}`;
          return <Rail key={o.id} title={o.h1} sub={sub} href={href} cta="See all" load={load} />;
        })}
      </>
    );
  } else {
    const liveOffers = vertical!.offers.filter((o) => isOfferLive(vertical!.id, o.id))
      .sort((a, b) => Number(b.id === offer?.id) - Number(a.id === offer?.id));
    const rails = liveOffers.map((o) => {
      const b = bindingOf(vertical!.id, o.id)!;
      const load = b.kind === 'units' ? (units[`spaces.${o.id}`] ?? { state: 'loading' as const }) : services(new Set(b.categoryCodes));
      const href = b.kind === 'units' ? unitsSearchHref(b)
        : b.categoryCodes.length === 1 ? `/services?category=${b.categoryCodes[0]}` : '/services';
      return { o, load, href };
    });
    const allEmpty = rails.every((r) => r.load.state === 'ok' && r.load.data.length === 0)
      && !(tab === 'services' && unmappedCodes.size > 0);
    body = (
      <>
        {rails.map(({ o, load, href }) => (
          <Rail key={o.id} title={o.h1} sub={o.basis ? `${o.basis} · verified providers` : undefined} href={href} cta="See all" load={load} />
        ))}
        {tab === 'services' && unmappedCodes.size > 0 && (
          <Rail title="More home services" sub="Plumbing, pest control, car care and more" href="/services" cta="See all services" load={services(unmappedCodes)} />
        )}
        {allEmpty && (
          <section className="section"><div className="empty"><b>No published listings yet</b>
            New {vertical!.label.toLowerCase()} listings appear here as soon as UpNow approves them.</div></section>
        )}
      </>
    );
  }

  return (
    <div className="mkt">
      <SiteHeader />
      <main>
        <section className="hero">
          <div className="hero-bg"><img key={heroImg} src={heroImg} alt="" /></div>
          <div className="wrap">
            <span className="kicker"><ShieldCheck size={14} aria-hidden /> Verified providers across the UAE</span>
            <h1>{h1}</h1>
            <p className="subtitle">{sub}</p>

            <div className="vtabs" role="tablist" aria-label="Verticals">
              {tabs.map((t) => {
                const Ic = t === 'all' ? LayoutGrid : VICON[t];
                const soon = t !== 'all' && !isVerticalLive(t);
                return (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                    <Ic size={15} aria-hidden /> {t === 'all' ? 'All' : verticalOf(t)!.label}
                    {soon && <span className="soon-tag">Soon</span>}
                  </button>
                );
              })}
            </div>
            <div className="panel" role="tabpanel">
              {vertical && (
                <div className="offer-row" aria-label={`${vertical.label} categories`}>
                  {vertical.offers.map((o) => {
                    const live = isOfferLive(vertical.id, o.id);
                    const ok = live || isOfferPreview(vertical.id, o.id);
                    return (
                      <button key={o.id} type="button" className="offer-chip" disabled={!ok}
                        aria-pressed={ok && offer?.id === o.id} onClick={() => setTab(vertical.id, o.id)}
                        title={ok ? (live ? undefined : 'Preview listings — no real payment') : 'Coming soon'}>
                        {o.label}{!ok && <small>Soon</small>}{ok && !live && <small>Preview</small>}
                      </button>
                    );
                  })}
                </div>
              )}
              {tab === 'spaces' && offer && selPreview && !isOfferLive('spaces', offer.id) ? (
                <div className="soon-panel">
                  <span className="ic"><CalendarCheck size={18} aria-hidden /></span>
                  <div>
                    <b>{offer.label} — Preview</b>
                    <p>{PREVIEW_SUB}. Pick a listing below or <Link href={`/book?model=${selPreview}`} style={{ color: 'var(--ms-primary)', fontWeight: 700 }}>browse all {MODEL_PLURAL[selPreview].toLowerCase()}</Link>.</p>
                  </div>
                </div>
              ) : tab === 'all' || tab === 'spaces' ? <SpacesSearch offer={tab === 'spaces' ? offer : null} />
                : tab === 'services' ? <ServicesSearch offer={offer} />
                : (
                  <div className="soon-panel">
                    <span className="ic"><Clock3 size={18} aria-hidden /></span>
                    <div>
                      <b>{vertical!.label} is coming soon</b>
                      <p>We&apos;re preparing licence checks for {vertical!.label.toLowerCase()} providers. Spaces and Services are open today.</p>
                    </div>
                  </div>
                )}
            </div>
          </div>
          <span className="hero-credit">{vertical ? `${vertical.label}${offer ? ` · ${offer.label}` : ''}` : 'All verticals'}</span>
        </section>

        <div className="trust">
          <span><ShieldCheck size={15} aria-hidden /> Providers verified by UpNow</span>
          <span><Check size={15} aria-hidden /> Every listing reviewed before it goes live</span>
          <span><CalendarCheck size={15} aria-hidden /> Request viewings &amp; book online</span>
        </div>

        <div className="wrap">
          {body}

          {(tab === 'all' || tab === 'spaces') && areas.length > 0 && (
            <section className="section">
              <div className="sec-head"><div><h2>Areas with live listings</h2><p>Jump straight to results in these communities.</p></div></div>
              <div className="areas">
                {areas.map((a) => (
                  <Link key={a} href={`/listings?q=${encodeURIComponent(a)}`}>
                    <span>{a}<small>Browse spaces</small></span><ChevronRight size={16} aria-hidden />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="section">
            <div className="sec-head"><div><h2>How UpNow works</h2><p>Verified providers, reviewed listings, one account.</p></div></div>
            <div className="how">
              {STEPS.map(([b, s], i) => <div key={b}><span className="n">{i + 1}</span><b>{b}</b><span>{s}</span></div>)}
            </div>
          </section>

          <section className="cta">
            <div>
              <h2>Run a business? List it on UpNow.</h2>
              <p>Landlords, agencies and service companies: get verified once, publish listings after review, and manage leads, leases and bookings in the UpNow OS.</p>
            </div>
            {/* Full navigation on purpose: the header opens the sign-up popup from ?auth on load. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- must be a full page load (see above) */}
            <a className="btn btn-light" href="/?auth=signup">List your business <ArrowRight size={16} aria-hidden /></a>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
