/**
 * Public services catalog — renders EXACTLY what the admin console configures
 * (GET /api/catalog/public): active categories → services → sub-type packages.
 * No hardcoded taxonomy: opening a PHASE-2 service or fixing a price in
 * /dashboard/admin/catalog changes this page on the next load (CEO Pack 4
 * model). Booking itself arrives with SP Sprint 2 — CTAs communicate that
 * honestly; the Commercial category renders as a "For Business" band with a
 * proposal CTA instead of consumer booking (Decision 1, Pack 1).
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Wind, Droplets, Zap, Hammer, PaintRoller, Bug, Car, Trees,
  Building2, Wrench, Clock, Loader2, ChevronDown, ChevronUp, BadgeCheck,
  Briefcase, AlarmClockCheck,
} from 'lucide-react';

/* ── Shapes (GET /api/catalog/public) ──────────────────────────────────────── */
interface PublicPackage {
  id: number;
  code: string;
  name: string;
  basePrice: number | null;
  estimatedDuration: number | null;
  estimatedDurationMax: number | null;
}
interface PublicService {
  id: number;
  code: string;
  name: string;
  description: string | null;
  priceUnit: string;
  pricingMode: string;
  basePrice: number | null;
  isFromPrice: boolean;
  minCalloutCharge: number | null;
  isEmergency: boolean;
  estimatedDuration: number | null;
  estimatedDurationMax: number | null;
  packageGroupLabel: string | null;
  packages: PublicPackage[];
}
interface PublicCategory {
  id: number;
  code: string;
  name: string;
  iconKey: string | null;
  services: PublicService[];
}

/* ── Icon + accent mapping (keys owned by admin console / seed 0107) ───────── */
const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
  sparkles: Sparkles, wind: Wind, droplets: Droplets, zap: Zap, hammer: Hammer,
  'paint-roller': PaintRoller, bug: Bug, car: Car, trees: Trees, 'building-2': Building2,
};
const CATEGORY_TONES: Record<string, { bg: string; fg: string }> = {
  home_cleaning:       { bg: '#e0f2fe', fg: '#0369a1' },
  ac_services:         { bg: '#ecfeff', fg: '#0e7490' },
  plumbing:            { bg: '#dbeafe', fg: '#1d4ed8' },
  electrical:          { bg: '#fef9c3', fg: '#ca8a04' },
  handyman:            { bg: '#fef3c7', fg: '#b45309' },
  painting:            { bg: '#fae8ff', fg: '#a21caf' },
  pest_control:        { bg: '#dcfce7', fg: '#15803d' },
  car_vehicle:         { bg: '#e0e7ff', fg: '#4338ca' },
  landscaping_outdoor: { bg: '#d1fae5', fg: '#047857' },
  commercial_services: { bg: '#f3f4f6', fg: '#374151' },
};

const FOR_BUSINESS_CODE = 'commercial_services';

function fmtAed(n: number) { return n.toLocaleString('en-AE'); }
function priceLabel(s: PublicService): string {
  if (s.pricingMode === 'quote' || s.basePrice == null) return 'Free quote';
  const suffix = s.priceUnit === 'per_hour' ? '/hr' : '';
  return `${s.isFromPrice ? 'From ' : ''}AED ${fmtAed(Number(s.basePrice))}${suffix}`;
}
function durLabel(min: number | null, max: number | null): string | null {
  if (!min) return null;
  const f = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`);
  return max && max !== min ? `${f(min)}–${f(max)}` : f(min);
}

/* ── Service card ──────────────────────────────────────────────────────────── */
function ServiceCard({ s, tone }: { s: PublicService; tone: { bg: string; fg: string } }) {
  const [open, setOpen] = useState(false);
  const dur = durLabel(s.estimatedDuration, s.estimatedDurationMax);
  const hasPackages = s.packages.length > 0;
  return (
    <div className="rounded-2xl border bg-white p-5 flex flex-col" style={{ borderColor: 'var(--color-base-200)' }}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-tight" style={{ color: 'var(--color-neutral-900)' }}>{s.name}</h3>
        {s.isEmergency && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0" style={{ background: '#fee2e2', color: '#b91c1c' }}>
            <AlarmClockCheck size={11} /> 24/7
          </span>
        )}
      </div>
      {s.description && (
        <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--color-neutral-500)' }}>{s.description}</p>
      )}
      <div className="flex items-center gap-3 mt-3 text-sm">
        <span className="font-bold" style={{ color: tone.fg }}>{priceLabel(s)}</span>
        {dur && (
          <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-400)' }}>
            <Clock size={12} /> {dur}
          </span>
        )}
      </div>

      {hasPackages && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1 text-xs font-semibold"
            style={{ color: 'var(--color-neutral-600)' }}
          >
            {s.packageGroupLabel ?? 'Options'} · {s.packages.length}
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {open && (
            <div className="mt-2 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-base-200)' }}>
              {s.packages.map((p, i) => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs" style={{ borderTop: i ? '1px solid var(--color-base-200)' : undefined }}>
                  <span style={{ color: 'var(--color-neutral-700)' }}>{p.name}</span>
                  <span className="font-semibold whitespace-nowrap" style={{ color: 'var(--color-neutral-900)' }}>
                    {p.basePrice != null ? `AED ${fmtAed(Number(p.basePrice))}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--color-base-100)' }}>
        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-neutral-400)' }}>
          <BadgeCheck size={13} style={{ color: 'var(--color-primary)' }} /> Vetted, licensed providers
        </span>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>
          Booking opens soon
        </span>
      </div>
    </div>
  );
}

/* ── Page body ─────────────────────────────────────────────────────────────── */
export default function ServicesCatalogClient() {
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/catalog/public')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { categories?: PublicCategory[] }) => setCategories(d.categories ?? []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const consumer = useMemo(
    () => categories.filter((c) => c.code !== FOR_BUSINESS_CODE && c.services.length > 0),
    [categories],
  );
  const business = useMemo(
    () => categories.find((c) => c.code === FOR_BUSINESS_CODE),
    [categories],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-24">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-primary)' }} />
        <span className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>Loading services…</span>
      </div>
    );
  }

  if (failed || consumer.length === 0) {
    return (
      <div className="text-center py-24 px-6">
        <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-50)' }}>
          <Wrench size={24} style={{ color: 'var(--color-primary)' }} />
        </div>
        <h2 className="text-lg font-semibold mb-1.5" style={{ color: 'var(--color-neutral-900)' }}>Services are on the way</h2>
        <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--color-neutral-500)' }}>
          Our home-services catalog is being prepared. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Category pill nav */}
      <nav className="flex gap-2 overflow-x-auto pb-2 mb-8 -mx-1 px-1">
        {consumer.map((c) => {
          const Icon = CATEGORY_ICONS[c.iconKey ?? ''] ?? Wrench;
          const tone = CATEGORY_TONES[c.code] ?? CATEGORY_TONES.commercial_services;
          return (
            <a
              key={c.id}
              href={`#cat-${c.code}`}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap border bg-white"
              style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-700)' }}
            >
              <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: tone.bg }}>
                <Icon size={12} style={{ color: tone.fg }} />
              </span>
              {c.name}
            </a>
          );
        })}
      </nav>

      {/* Category sections */}
      {consumer.map((c) => {
        const Icon = CATEGORY_ICONS[c.iconKey ?? ''] ?? Wrench;
        const tone = CATEGORY_TONES[c.code] ?? CATEGORY_TONES.commercial_services;
        return (
          <section key={c.id} id={`cat-${c.code}`} className="mb-12 scroll-mt-24">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: tone.bg }}>
                <Icon size={17} style={{ color: tone.fg }} />
              </span>
              <h2 className="text-lg font-bold" style={{ color: 'var(--color-neutral-900)' }}>{c.name}</h2>
              <span className="text-xs font-medium" style={{ color: 'var(--color-neutral-400)' }}>
                {c.services.length} service{c.services.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {c.services.map((s) => <ServiceCard key={s.id} s={s} tone={tone} />)}
            </div>
          </section>
        );
      })}

      {/* For Business band (commercial trio routed out of the consumer flow) */}
      {business && business.services.length > 0 && (
        <section className="rounded-3xl p-8 mb-6" style={{ background: 'var(--color-neutral-900)' }}>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-[240px]">
              <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#9ca3af' }}>
                <Briefcase size={13} /> For Business
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
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              Request a proposal
            </a>
          </div>
        </section>
      )}
    </>
  );
}
