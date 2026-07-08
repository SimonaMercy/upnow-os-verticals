/**
 * SP "My Services" — the provider's service listings, wired to the SP catalog
 * API (SP Sprint 1, SCRUM-372/382/385). List + availability toggle + price
 * edit + delete-while-pending; adding happens on the /services/new picker.
 * GATE 1: activating a listing 403s until the account is compliance-approved
 * (server-enforced); GATE 2: new/edited listings sit 'pending' until admin
 * approval.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { apiGet, apiPatch, apiDelete } from '@/lib/api';

interface SpService {
  id: number;
  name?: string | null;
  category?: string | null;
  basePrice?: number | string | null;
  priceUnit?: string | null;
  pricingMode?: string | null;
  isFromPrice?: boolean | null;
  listingStatus?: string | null;
  isAvailable?: boolean | null;
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  approved: { bg: '#d8f2e8', fg: '#1a7a5a', label: 'approved' },
  pending:  { bg: '#fef3c7', fg: '#92400e', label: 'in review' },
  rejected: { bg: '#fee2e2', fg: '#991b1b', label: 'rejected' },
};

const CATEGORY_LABELS: Record<string, string> = {
  home_cleaning: 'Home Cleaning', ac_services: 'AC Services', plumbing: 'Plumbing',
  electrical: 'Electrical', handyman: 'Handyman', painting: 'Painting',
  pest_control: 'Pest Control', car_vehicle: 'Car & Vehicle',
  landscaping_outdoor: 'Landscaping & Outdoor', commercial_services: 'Commercial Services',
};

function priceLabel(s: SpService): string {
  if (s.pricingMode === 'quote' || s.basePrice == null) return 'Quote';
  const base = `AED ${Number(s.basePrice).toLocaleString('en-AE')}`;
  const suffix = s.priceUnit === 'per_hour' ? '/hr' : '';
  return `${s.isFromPrice !== false ? 'From ' : ''}${base}${suffix}`;
}

export default function SpMyServicesPage() {
  const [services, setServices] = useState<SpService[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    apiGet<SpService[] | { data?: SpService[] }>('/service-provider/services')
      .then((d) => setServices(Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : [])))
      .catch(() => setServices([]));

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const run = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(null); }
  };

  const toggle = (s: SpService) =>
    run(s.id, () => apiPatch(`/service-provider/services/${s.id}`, { isAvailable: !s.isAvailable }));

  const remove = (s: SpService) => {
    if (!window.confirm(`Remove "${s.name}" from your services?`)) return;
    void run(s.id, () => apiDelete(`/service-provider/services/${s.id}`));
  };

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-neutral-900)' }}>My Services</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-neutral-500)' }}>
            The services you offer, adopted from the UpNow catalog. Prices are set by UpNow —
            you control which services you offer and their availability.
            New listings are reviewed by UpNow before going live.
          </p>
        </div>
        <Link
          href="/dashboard/service-provider/services/new"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={15} /> Add from catalog
        </Link>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: '#fef2f2', color: 'var(--color-error)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border p-10 text-center text-sm" style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-500)' }}>
          Loading services…
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--color-base-200)' }}>
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-50)' }}>
            <Briefcase size={24} style={{ color: 'var(--color-primary)' }} />
          </div>
          <h2 className="text-base font-semibold mb-1.5" style={{ color: 'var(--color-neutral-900)' }}>No services yet</h2>
          <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--color-neutral-500)' }}>
            Pick the services you offer from the UpNow catalog and submit them
            for review. Prices are set by UpNow. Approved services appear to customers and
            start receiving bookings.
          </p>
          <Link
            href="/dashboard/service-provider/services/new"
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <Plus size={15} /> Browse the catalog
          </Link>
          <p className="text-xs mt-4 inline-flex items-center gap-1.5 w-full justify-center" style={{ color: 'var(--color-neutral-400)' }}>
            <ShieldCheck size={13} /> Your account must be compliance-approved before services go live.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden bg-white" style={{ borderColor: 'var(--color-base-200)' }}>
          {services.map((s, i) => {
            const st = (s.listingStatus ?? 'pending').toLowerCase();
            const tone = STATUS_STYLE[st] ?? STATUS_STYLE.pending;
            const isQuote = s.pricingMode === 'quote';
            const rowBusy = busy === s.id;
            return (
              <div key={s.id} className="flex items-center gap-4 px-4 py-3 flex-wrap" style={{ borderTop: i ? '1px solid var(--color-base-200)' : undefined }}>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--color-neutral-900)' }}>{s.name ?? '—'}</div>
                  <div className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                    {CATEGORY_LABELS[s.category ?? ''] ?? s.category ?? '—'}
                  </div>
                </div>

                {/* Price is platform-set by UpNow — display only */}
                <span
                  title={isQuote ? 'Priced per job via quotes' : 'Price set by UpNow'}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap"
                  style={{ color: 'var(--color-neutral-900)' }}
                >
                  {priceLabel(s)}
                </span>

                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize" style={{ backgroundColor: tone.bg, color: tone.fg }}>
                  {tone.label}
                </span>

                {/* Availability switch — server 403s activation until compliant (GATE 1) */}
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  disabled={rowBusy}
                  className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                  style={{ background: s.isAvailable ? 'var(--color-primary)' : 'var(--color-base-200)' }}
                  title={s.isAvailable ? 'Available — click to pause' : 'Paused — click to activate'}
                  aria-pressed={Boolean(s.isAvailable)}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                    style={{ left: s.isAvailable ? 18 : 2 }}
                  />
                </button>

                {st !== 'approved' && (
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    disabled={rowBusy}
                    className="p-1.5 rounded-lg"
                    title="Remove"
                    style={{ color: 'var(--color-neutral-400)' }}
                  >
                    {rowBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
