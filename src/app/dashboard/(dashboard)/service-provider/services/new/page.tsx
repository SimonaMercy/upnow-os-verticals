/**
 * SP "Add from catalog" — the adopt-from-catalog picker (SP Sprint 1,
 * SCRUM-372/379). Shows the platform rate card (GET /service-provider/catalog)
 * grouped by category; adopting (POST /service-provider/services) creates a
 * pending listing for admin review (GATE 2). Replaces the ComingSoon stub.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2, Plus, ShieldCheck } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

interface CatalogCategory {
  id: number;
  code: string;
  nameEn: string;
  sortOrder: number;
}
interface CatalogTemplate {
  id: number;
  serviceCategoryId: number;
  name: string;
  description: string | null;
  basePrice: number | null;
  priceUnit: string;
  pricingMode: string;
  isFromPrice: boolean;
  estimatedDuration: number | null;
  estimatedDurationMax: number | null;
  adoptedServiceId: number | null;
}

function priceLabel(t: CatalogTemplate): string {
  if (t.pricingMode === 'quote' || t.basePrice == null) return 'Quote';
  const base = `AED ${Number(t.basePrice).toLocaleString('en-AE')}`;
  const suffix = t.priceUnit === 'per_hour' ? '/hr' : '';
  return `${t.isFromPrice ? 'From ' : ''}${base}${suffix}`;
}

function durationLabel(t: CatalogTemplate): string | null {
  if (!t.estimatedDuration) return null;
  const fmt = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);
  return t.estimatedDurationMax && t.estimatedDurationMax !== t.estimatedDuration
    ? `${fmt(t.estimatedDuration)}–${fmt(t.estimatedDurationMax)}`
    : fmt(t.estimatedDuration);
}

export default function SpAddFromCatalogPage() {
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [templates, setTemplates] = useState<CatalogTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    apiGet<{ categories: CatalogCategory[]; templates: CatalogTemplate[] }>('/service-provider/catalog')
      .then((d) => { setCategories(d.categories ?? []); setTemplates(d.templates ?? []); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the catalog'))
      .finally(() => setLoading(false));
  }, []);

  const byCategory = useMemo(() => {
    const m = new Map<number, CatalogTemplate[]>();
    for (const t of templates) {
      const a = m.get(t.serviceCategoryId) ?? [];
      a.push(t);
      m.set(t.serviceCategoryId, a);
    }
    return m;
  }, [templates]);

  const adopt = async (t: CatalogTemplate) => {
    setBusy(t.id);
    setError(null);
    try {
      const created = await apiPost<{ id: number }>('/service-provider/services', { templateId: t.id });
      setTemplates((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, adoptedServiceId: created?.id ?? -1 } : x)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the service');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <Link
        href="/dashboard/service-provider/services"
        className="inline-flex items-center gap-1.5 text-sm mb-4"
        style={{ color: 'var(--color-neutral-500)' }}
      >
        <ArrowLeft size={15} /> My Services
      </Link>

      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
          Add services from the catalog
        </h1>
        <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--color-neutral-500)' }}>
          Pick the services your business offers. Prices shown are the platform&apos;s
          starting rates — you can adjust yours after adding. New services are
          reviewed by UpNow before customers see them.
        </p>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: '#fef2f2', color: 'var(--color-error)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-3 py-16 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-primary)' }} />
          <span className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>Loading catalog…</span>
        </div>
      ) : (
        categories.map((cat) => {
          const items = byCategory.get(cat.id) ?? [];
          if (!items.length) return null;
          return (
            <section key={cat.id} className="mb-8">
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-neutral-900)' }}>
                {cat.nameEn}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((t) => {
                  const adopted = t.adoptedServiceId != null;
                  const dur = durationLabel(t);
                  return (
                    <div
                      key={t.id}
                      className="rounded-2xl border p-4 flex flex-col gap-2 bg-white"
                      style={{ borderColor: adopted ? 'var(--color-primary)' : 'var(--color-base-200)' }}
                    >
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
                        {t.name}
                      </div>
                      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                        <span className="font-semibold" style={{ color: 'var(--color-neutral-800)' }}>{priceLabel(t)}</span>
                        {dur && <span>· {dur}</span>}
                      </div>
                      <button
                        type="button"
                        disabled={adopted || busy === t.id}
                        onClick={() => adopt(t)}
                        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity"
                        style={adopted
                          ? { background: 'color-mix(in srgb, var(--color-primary) 8%, white)', color: 'var(--color-primary)', cursor: 'default' }
                          : { background: 'var(--color-primary)', color: '#fff', opacity: busy === t.id ? 0.6 : 1 }}
                      >
                        {adopted ? (<><Check size={13} /> Added — in review</>)
                          : busy === t.id ? (<Loader2 size={13} className="animate-spin" />)
                          : (<><Plus size={13} /> Add to my services</>)}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {!loading && (
        <p className="text-xs mt-2 inline-flex items-center gap-1.5" style={{ color: 'var(--color-neutral-400)' }}>
          <ShieldCheck size={13} /> Services go live once your account is verified and the listing is approved.
        </p>
      )}
    </div>
  );
}
