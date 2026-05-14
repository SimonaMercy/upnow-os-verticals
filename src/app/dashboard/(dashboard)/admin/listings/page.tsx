'use client';

import { useEffect, useState } from 'react';
import { Building2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { DashboardPage, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { apiGet } from '@/lib/api';

interface AdminProperty {
  id: number;
  buildingName: string;
  fullAddress: string | null;
  spaceCategory: string;
  rentalProviderId: number;
  unitCount: number;
  listedCount: number;
  createdAt: string;
}

const categoryLabel: Record<string, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
};

const categoryColor: Record<string, { bg: string; color: string }> = {
  residential: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  commercial: { bg: '#eff6ff', color: '#3b82f6' },
  industrial: { bg: '#f5f3ff', color: '#8b5cf6' },
};

export default function AdminListingsPage() {
  const [properties, setProperties] = useState<AdminProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');

  async function fetchProperties() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<AdminProperty[]>('/admin/properties');
      setProperties(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchProperties(); }, []);

  const filtered = categoryFilter
    ? properties.filter((p) => p.spaceCategory === categoryFilter)
    : properties;

  const totalUnits = properties.reduce((s, p) => s + p.unitCount, 0);
  const totalListed = properties.reduce((s, p) => s + p.listedCount, 0);

  return (
    <DashboardPage
      title="All Listings"
      subtitle="Properties across all rental providers on the platform."
    >
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Properties', value: properties.length },
          { label: 'Total Units', value: totalUnits },
          { label: 'Listed Units', value: totalListed },
          { label: 'Unlisted Units', value: totalUnits - totalListed },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-2xl p-4 text-center" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <p className="text-2xl font-bold" style={{ color: 'var(--color-neutral-900)' }}>{value}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {['', 'residential', 'commercial', 'industrial'].map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={
              categoryFilter === cat
                ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }
            }
          >
            {cat ? categoryLabel[cat] : 'All'}
          </button>
        ))}

        <button
          onClick={() => void fetchProperties()}
          className="p-2.5 rounded-xl bg-white transition-colors hover:bg-base-100 ml-auto"
          style={{ boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-base-200)' }}
          title="Refresh"
        >
          <RefreshCw size={15} style={{ color: 'var(--color-neutral-500)' }} />
        </button>
      </div>

      {loading && (
        <div className="rounded-2xl p-8 bg-white text-center text-sm" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>
          Loading…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl p-8 bg-white text-center text-sm" style={{ color: 'var(--color-error)', boxShadow: 'var(--shadow-sm)' }}>
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <DashboardEmpty message={categoryFilter ? `No ${categoryLabel[categoryFilter]?.toLowerCase()} properties found.` : 'No properties on the platform yet.'} />
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <SectionHeader title={`${filtered.length} propert${filtered.length !== 1 ? 'ies' : 'y'}`} />

          <div className="space-y-3">
            {filtered.map((p) => {
              const cc = categoryColor[p.spaceCategory] ?? { bg: 'var(--color-base-100)', color: 'var(--color-neutral-600)' };
              return (
                <div
                  key={p.id}
                  className="bg-white rounded-2xl p-5 flex flex-wrap items-center gap-4"
                  style={{ boxShadow: 'var(--shadow-sm)' }}
                >
                  {/* Icon */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: cc.bg }}
                  >
                    <Building2 size={18} style={{ color: cc.color }} />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                      {p.buildingName}
                    </p>
                    {p.fullAddress && (
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>
                        {p.fullAddress}
                      </p>
                    )}
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-400)' }}>
                      RP #{p.rentalProviderId} · Added {new Date(p.createdAt).toLocaleDateString('en-AE')}
                    </p>
                  </div>

                  {/* Category */}
                  <span
                    className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cc.bg, color: cc.color }}
                  >
                    {categoryLabel[p.spaceCategory] ?? p.spaceCategory}
                  </span>

                  {/* Units */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span
                      className="flex items-center gap-1 text-xs"
                      style={{ color: 'var(--color-neutral-600)' }}
                    >
                      <Eye size={13} /> {p.listedCount} listed
                    </span>
                    <span
                      className="flex items-center gap-1 text-xs"
                      style={{ color: 'var(--color-neutral-400)' }}
                    >
                      <EyeOff size={13} /> {p.unitCount - p.listedCount} unlisted
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </DashboardPage>
  );
}
