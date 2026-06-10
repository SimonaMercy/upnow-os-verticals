'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Menu, X, LogOut, Building2, Home, Factory, Wrench, Leaf, Wind,
  Star, MapPin, Heart, Search, ArrowRight, ChevronDown, Check,
  User, Key, UserCircle, Bell, Calendar, HelpCircle, Grid3X3,
} from 'lucide-react';
import { useAuth, dashboardPath } from '@/contexts/AuthContext';
import { HowItWorks } from '@/components/upnow/HowItWorks';
import { TrustSignals } from '@/components/upnow/TrustSignals';
import { Footer } from '@/components/upnow/Footer';
import { SignupChoice } from '@/components/upnow/SignupChoice';

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
    unit.bedrooms ? `${unit.bedrooms} bed` : null,
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

function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void,
) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
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
  prov: string;
  price: string;
  per: string;
  rate: number;
  n: string;
  badge?: string;
  img: string;
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
};

function fallbackImg(category: string, id: number): string {
  const pool = FALLBACK_IMGS[category] ?? FALLBACK_IMGS.residential;
  return `${UPH}${pool[id % pool.length]}${UQ}`;
}

const SERVICE_CATS: ServiceCat[] = [
  {
    id: 'home-office',
    label: 'Home & Office',
    blurb: 'AC, plumbing, electrical, carpentry & appliances',
    href: '/services?category=home-office-maintenance',
    items: [
      { title: 'AC Servicing & Repair',  prov: 'CoolCare Technical', price: 'AED 99',  per: '/visit', rate: 4.96, n: '1.2k', badge: 'Same day',  img: `${UPH}1581094794329-c8112a89af12${UQ}` },
      { title: 'Plumbing & Leak Fix',    prov: 'AquaFix UAE',        price: 'AED 120', per: '/job',   rate: 4.88, n: '840',               img: `${UPH}1607472586893-edb57bdc0e39${UQ}` },
      { title: 'Electrical & Wiring',    prov: 'Voltify',             price: 'AED 90',  per: '/visit', rate: 4.91, n: '610',               img: `${UPH}1558618666-fcd25c85cd64${UQ}` },
      { title: 'Handyman & Carpentry',   prov: 'FixMate',             price: 'AED 80',  per: '/hour',  rate: 4.85, n: '930', badge: 'Top rated', img: `${UPH}1504148455328-c376907d081c${UQ}` },
    ],
  },
  {
    id: 'cleaning',
    label: 'Cleaning & Hygiene',
    blurb: 'Home, office, deep cleaning & sanitization',
    href: '/services?category=cleaning-hygiene',
    items: [
      { title: 'Deep Home Cleaning', prov: 'Sparkle Co.', price: 'AED 150', per: '/session', rate: 4.94, n: '2.1k', badge: 'Popular', img: `${UPH}1581578731548-c64695cc6952${UQ}` },
      { title: 'Office Cleaning',    prov: 'PureSpace',   price: 'AED 200', per: '/visit',   rate: 4.87, n: '560',                  img: `${UPH}1628177142898-93e36e4e3a50${UQ}` },
      { title: 'Sofa & Carpet Care', prov: 'FreshNest',   price: 'AED 110', per: '/item',    rate: 4.83, n: '720',                  img: `${UPH}1527515637462-cff94eecc1ac${UQ}` },
      { title: 'Sanitization',       prov: 'BioShield',   price: 'AED 130', per: '/visit',   rate: 4.90, n: '410',                  img: `${UPH}1563453392212-326f5e854473${UQ}` },
    ],
  },
  {
    id: 'wellness',
    label: 'Lifestyle & Wellness',
    blurb: 'Grooming, healthcare, pet care & family support',
    href: '/services?category=wellness',
    items: [
      { title: 'At-home Salon & Spa', prov: 'GlowUp',   price: 'AED 99',  per: '/session', rate: 4.95, n: '1.5k', badge: 'Trending', img: `${UPH}1560066984-138dadb4c035${UQ}` },
      { title: 'Home Nursing',         prov: 'CarePlus', price: 'AED 180', per: '/visit',   rate: 5.0,  n: '320',                    img: `${UPH}1576091160550-2173dba999ef${UQ}` },
      { title: 'Pet Grooming',         prov: 'PawsUp',   price: 'AED 120', per: '/pet',     rate: 4.86, n: '480',                    img: `${UPH}1601758228041-f3b2795255f1${UQ}` },
      { title: 'Personal Training',    prov: 'FitHome',  price: 'AED 150', per: '/session', rate: 4.92, n: '390',                    img: `${UPH}1571019613454-1cb2f99b2d8b${UQ}` },
    ],
  },
  {
    id: 'outdoor',
    label: 'Outdoor & Landscaping',
    blurb: 'Gardens, pools, pest control & facade care',
    href: '/services?category=outdoor-landscaping',
    items: [
      { title: 'Garden & Landscaping',    prov: 'GreenScape', price: 'AED 250', per: '/visit',     rate: 4.89, n: '410', badge: 'Seasonal', img: `${UPH}1416879595882-3373a0480b5b${UQ}` },
      { title: 'Pool Maintenance',        prov: 'AquaBlue',   price: 'AED 200', per: '/month',     rate: 4.84, n: '260',                   img: `${UPH}1558904541-efa843a96f01${UQ}` },
      { title: 'Pest Control',            prov: 'ShieldPest', price: 'AED 140', per: '/treatment', rate: 4.90, n: '680',                   img: `${UPH}1599629954294-14df9ec8bc02${UQ}` },
      { title: 'Facade & Window Clean',   prov: 'ClearView',  price: 'AED 300', per: '/job',       rate: 4.81, n: '190',                   img: `${UPH}1604762524889-3e2fcc145683${UQ}` },
    ],
  },
];

const SPACE_CAT_ICONS: Record<string, React.ReactNode> = {
  residential: <Home size={16} />,
  commercial: <Building2 size={16} />,
  industrial: <Factory size={16} />,
};

const SERVICE_CAT_ICONS: Record<string, React.ReactNode> = {
  'home-office': <Wrench size={16} />,
  cleaning: <Wind size={16} />,
  wellness: <Leaf size={16} />,
  outdoor: <Leaf size={16} />,
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
    <article className="l-pcard">
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
          <span className="rate">
            <Star size={12} fill="#d99036" stroke="none" style={{ display: 'inline', marginRight: 3 }} />
            {item.rate}
            <span style={{ color: '#6b7a74', fontWeight: 500 }}> ({item.n})</span>
          </span>
        </div>
        <div className="loc">{item.prov}</div>
        <div className="price">From {item.price} <small>{item.per}</small></div>
      </div>
    </article>
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

// ─── NAV ─────────────────────────────────────────────────────────────────────

const customerDropdownItems = [
  { label: 'Profile', icon: UserCircle, href: '/dashboard/customer/profile' },
  { label: 'My Spaces', icon: Building2, href: '/dashboard/customer/spaces' },
  { label: 'My Services', icon: Calendar, href: '/dashboard/customer/services' },
  { label: 'Notifications', icon: Bell, href: '/dashboard/customer/notifications' },
  { label: 'Help Center', icon: HelpCircle, href: '/dashboard/customer/help' },
] as const;

function LandingNav({
  mode,
  setMode,
}: {
  mode: 'services' | 'spaces';
  setMode: (m: 'services' | 'spaces') => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  useClickOutside(avatarRef, () => setAvatarOpen(false));

  const { isAuthenticated, user, signOut } = useAuth();
  const displayName = user?.name ?? [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const initials = displayName?.charAt(0)?.toUpperCase() ?? 'U';
  const isCustomerRole = user?.role === 'customer';

  return (
    <>
      <header className="l-nav">
        <div className="l-nav-inner">
          {/* Brand */}
          <Link href="/" className="l-brand">
            <span className="l-brand-mark">U</span>
            UpNow
          </Link>

          {/* Center tabs */}
          <nav className="l-nav-center">
            {(['services', 'spaces'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`l-nav-tab${mode === m ? ' active' : ''}`}
              >
                <span className="dot" />
                {m === 'services' ? 'Services' : 'Spaces'}
              </button>
            ))}
            <a className="l-nav-link" href="#how-it-works">How it works</a>
            <a className="l-nav-link" href="#about">About Us</a>
          </nav>

          {/* Right: auth */}
          <div className="l-nav-actions hidden md:flex">
            {isAuthenticated ? (
              isCustomerRole ? (
                <div className="relative" ref={avatarRef}>
                  <button
                    onClick={() => setAvatarOpen(!avatarOpen)}
                    className="flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 hover:shadow-md transition-all cursor-pointer"
                    style={{ border: '1px solid #e8ece9', background: 'white' }}
                  >
                    <Menu size={16} style={{ color: '#6b7a74' }} />
                    <div
                      style={{
                        width: 32, height: 32, borderRadius: '50%',
                        backgroundColor: '#2e9f82', color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                      }}
                    >
                      {initials}
                    </div>
                  </button>
                  {avatarOpen && (
                    <div
                      style={{
                        position: 'absolute', right: 0, top: 52, width: 224,
                        backgroundColor: 'white', borderRadius: 12,
                        boxShadow: '0 8px 32px -4px rgba(0,0,0,0.16)',
                        overflow: 'hidden', zIndex: 60, padding: '6px 0',
                      }}
                    >
                      {customerDropdownItems.map((item) => (
                        <Link
                          key={item.label}
                          href={item.href}
                          onClick={() => setAvatarOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-sm"
                          style={{ color: '#36433d' }}
                        >
                          <item.icon size={16} style={{ color: '#6b7a74' }} />
                          {item.label}
                        </Link>
                      ))}
                      <div style={{ borderTop: '1px solid #e8ece9', margin: '4px 0' }} />
                      <button
                        onClick={signOut}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-sm text-left"
                        style={{ color: '#36433d' }}
                      >
                        <LogOut size={16} style={{ color: '#6b7a74' }} />
                        Log out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Link
                    href={user?.role ? dashboardPath(user.role) : '/dashboard'}
                    style={{
                      padding: '10px 16px', borderRadius: 999,
                      backgroundColor: '#2e9f82', color: 'white',
                      fontSize: 14, fontWeight: 600, textDecoration: 'none',
                    }}
                  >
                    {displayName?.split(' ')[0] || 'Dashboard'}
                  </Link>
                  <button
                    onClick={signOut}
                    className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg transition-colors hover:bg-gray-50"
                    style={{ color: '#36433d' }}
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </>
              )
            ) : (
              <>
                <Link
                  href="/login"
                  style={{
                    padding: '10px 16px', borderRadius: 999,
                    border: '1.5px solid #e8ece9', color: '#0e1a16',
                    fontSize: 14, fontWeight: 600, textDecoration: 'none',
                    backgroundColor: 'transparent',
                  }}
                >
                  Sign in
                </Link>
                <Link
                  href="/#signup"
                  style={{
                    padding: '10px 16px', borderRadius: 999,
                    backgroundColor: '#2e9f82', color: 'white',
                    fontSize: 14, fontWeight: 600, textDecoration: 'none',
                  }}
                >
                  Sign up
                </Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden"
            style={{ color: '#36433d', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={24} />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} className="md:hidden">
          <div
            style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)' }}
            onClick={() => setDrawerOpen(false)}
          />
          <div
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: 280,
              backgroundColor: 'white', boxShadow: '0 0 60px rgba(0,0,0,0.2)',
              display: 'flex', flexDirection: 'column', padding: 24,
            }}
          >
            <button
              onClick={() => setDrawerOpen(false)}
              style={{ alignSelf: 'flex-end', marginBottom: 24, color: '#36433d', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(['services', 'spaces'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setDrawerOpen(false); }}
                  style={{
                    padding: '10px 16px', borderRadius: 8, border: 'none',
                    textAlign: 'left', fontSize: 16, fontWeight: 600, cursor: 'pointer',
                    backgroundColor: mode === m ? '#e7f5f0' : 'transparent',
                    color: mode === m ? '#155a48' : '#36433d',
                    fontFamily: 'inherit',
                  }}
                >
                  {m === 'services' ? 'Services' : 'Spaces'}
                </button>
              ))}
              <a href="#how-it-works" onClick={() => setDrawerOpen(false)}
                style={{ padding: '10px 16px', fontSize: 16, fontWeight: 500, color: '#36433d', textDecoration: 'none' }}>
                How it works
              </a>
              <a href="#about" onClick={() => setDrawerOpen(false)}
                style={{ padding: '10px 16px', fontSize: 16, fontWeight: 500, color: '#36433d', textDecoration: 'none' }}>
                About Us
              </a>
            </div>
            <div style={{ borderTop: '1px solid #e8ece9', margin: '20px 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {isAuthenticated ? (
                <>
                  <Link
                    href={user?.role ? dashboardPath(user.role) : '/dashboard'}
                    onClick={() => setDrawerOpen(false)}
                    style={{
                      padding: '12px 16px', borderRadius: 999, backgroundColor: '#2e9f82',
                      color: 'white', fontWeight: 600, textAlign: 'center', textDecoration: 'none',
                    }}
                  >
                    Dashboard
                  </Link>
                  <button
                    onClick={() => { setDrawerOpen(false); signOut(); }}
                    style={{
                      padding: '12px 16px', borderRadius: 999, border: '1px solid #e8ece9',
                      backgroundColor: 'white', color: '#36433d', fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/#signup"
                    onClick={() => setDrawerOpen(false)}
                    style={{
                      padding: '12px 16px', borderRadius: 999, backgroundColor: '#2e9f82',
                      color: 'white', fontWeight: 600, textAlign: 'center', textDecoration: 'none',
                    }}
                  >
                    Sign up
                  </Link>
                  <Link
                    href="/login"
                    onClick={() => setDrawerOpen(false)}
                    style={{
                      padding: '12px 16px', borderRadius: 999, border: '1px solid #e8ece9',
                      backgroundColor: 'white', color: '#36433d', fontWeight: 600,
                      textAlign: 'center', textDecoration: 'none',
                    }}
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
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

// ─── HERO ─────────────────────────────────────────────────────────────────────

function Hero({
  mode,
  setMode,
  activeCat,
  setActiveCat,
}: {
  mode: 'services' | 'spaces';
  setMode: (m: 'services' | 'spaces') => void;
  activeCat: string;
  setActiveCat: (c: string) => void;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLDivElement>(null);

  const [locationText, setLocationText] = useState('');
  const [locationSel, setLocationSel] = useState<LocationSuggestion | null>(null);
  const [locOpen, setLocOpen] = useState(false);
  const [budgetSel, setBudgetSel] = useState<BudgetRange>(BUDGET_BRACKETS[0]);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [secondary, setSecondary] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);

  useEffect(() => { setLocOpen(false); setBudgetOpen(false); }, [mode]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!searchRef.current?.contains(e.target as Node)) {
        setLocOpen(false);
        setBudgetOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => {
    // Same-origin proxy (/api) — never an absolute backend URL. In the browser
    // this avoids CORS and works in every environment without a build-time
    // NEXT_PUBLIC_* var (which is how this hit localhost:3001 in production).
    const API = '/api';
    (async () => {
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
      } catch { /* silent — search still works without suggestions */ }
    })();
  }, []);

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
      if (secondary.trim()) params.set('when', secondary.trim());
    }

    router.push(`${base}${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const cats: { id: string; label: string }[] = mode === 'spaces' ? SPACE_CAT_DEFS : SERVICE_CATS;
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
                  setLocationText(e.target.value);
                  setLocationSel(null);
                  setLocOpen(true);
                  setBudgetOpen(false);
                }}
                onFocus={() => { if (locationText.trim()) setLocOpen(true); }}
                onKeyDown={e => {
                  if (e.key === 'Escape') setLocOpen(false);
                  if (e.key === 'Enter') { setLocOpen(false); handleSearch(); }
                }}
              />
            </div>

            {/* Budget / When field */}
            <div
              className="field"
              style={{ cursor: mode === 'spaces' ? 'pointer' : 'text' }}
              onClick={() => {
                if (mode === 'spaces') {
                  setBudgetOpen(v => !v);
                  setLocOpen(false);
                }
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
                <input
                  type="text"
                  placeholder="Anytime"
                  value={secondary}
                  onChange={e => setSecondary(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
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

// ─── PATHS SECTION ────────────────────────────────────────────────────────────

function PathsSection() {
  const paths = [
    {
      icon: <User size={24} />,
      title: 'Sign up as Customer',
      desc: 'Find a place to rent and book trusted home & business services near you.',
      cta: 'Create customer account',
      href: '/register/customer',
    },
    {
      icon: <Building2 size={24} />,
      title: 'Sign up as Rental Provider',
      desc: 'List apartments, offices or warehouses and manage tenancies in one dashboard.',
      cta: 'Create rental account',
      href: '/register/rental-provider',
    },
    {
      icon: <Key size={24} />,
      title: 'Sign up as Service Provider',
      desc: 'Offer maintenance and home services to customers in your area.',
      cta: 'Create service account',
      href: '/register/service-provider',
    },
  ];

  return (
    <section id="paths" style={{ background: '#fafbf9', paddingBlock: 64 }}>
      <div className="l-wrap">
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <span className="l-eyebrow">Get started</span>
          <h2 style={{ fontSize: 'clamp(26px,3vw,40px)', fontWeight: 700, letterSpacing: '-.022em', lineHeight: 1.06, marginTop: 12, color: '#0e1a16' }}>
            Pick the path that matches you.
          </h2>
          <p style={{ fontSize: 'clamp(16px,1.3vw,19px)', color: '#36433d', margin: '12px auto 0', textAlign: 'center', maxWidth: '54ch', lineHeight: 1.55 }}>
            Customers, rental providers and service providers each get a dedicated workspace.
          </p>
        </div>
        <div className="l-paths">
          {paths.map((p) => (
            <div key={p.title} className="l-path">
              <div className="pi">{p.icon}</div>
              <h4>{p.title}</h4>
              <p>{p.desc}</p>
              <Link href={p.href} className="cta">
                {p.cta} <ArrowRight size={14} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── GROW SECTION ─────────────────────────────────────────────────────────────

function GrowSection() {
  const cards = [
    {
      icon: <Wrench size={22} />,
      title: 'Offer your services',
      desc: 'Apply to list your service business and get matched with customers in your area.',
      cta: 'Submit an application',
      href: '/register/service-provider',
    },
    {
      icon: <Building2 size={22} />,
      title: 'List your space',
      desc: 'Publish apartments, offices or warehouses and manage everything in one dashboard.',
      cta: 'Submit an application',
      href: '/register/rental-provider',
    },
  ];

  return (
    <section id="about" style={{ paddingTop: 24, paddingBottom: 72 }}>
      <div className="l-wrap">
        <div className="l-grow">
          <div className="l-grow-inner">
            <h2>Grow your business with UpNow.</h2>
            <p className="gsub">
              Join hundreds of providers expanding their reach — list your space or offer your services to customers in your area.
            </p>
            <div className="l-grow-cards">
              {cards.map((card) => (
                <div key={card.title} className="l-gcard">
                  <div className="gi">{card.icon}</div>
                  <h4>{card.title}</h4>
                  <p>{card.desc}</p>
                  <Link href={card.href} className="btn">
                    {card.cta} <ArrowRight size={13} />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export function LandingPageV2() {
  const [mode, setMode] = useState<'services' | 'spaces'>('services');
  const [activeCat, setActiveCat] = useState<string>('all');
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
  const visibleServiceCats = activeCat === 'all' ? SERVICE_CATS : SERVICE_CATS.filter((c) => c.id === activeCat);

  return (
    <>
      <LandingNav mode={mode} setMode={handleSetMode} />

      <main>
        <Hero
          mode={mode}
          setMode={handleSetMode}
          activeCat={activeCat}
          setActiveCat={setActiveCat}
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
            : visibleServiceCats.map((cat) => (
                <CategoryRail key={cat.id} title={cat.label} blurb={cat.blurb} href={cat.href}>
                  {cat.items.map((item) => (
                    <ServiceCard key={item.title} item={item} />
                  ))}
                </CategoryRail>
              ))}
        </div>

        <div id="how-it-works">
          <HowItWorks />
        </div>

        <TrustSignals />

        <PathsSection />

        <GrowSection />

        {/* Sign-up section — the #signup anchor the "Sign up" links target. */}
        <SignupChoice />
      </main>

      <Footer />
    </>
  );
}
