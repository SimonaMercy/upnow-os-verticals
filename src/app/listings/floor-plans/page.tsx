'use client';

/**
 * Floor-plan gallery (apartment-search style): units grouped into layout PLANS
 * per property, each with a floor-plan image, bed/bath, size range and starting
 * price. Filterable by Bedrooms / Bathrooms / Price.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { ChevronDown, ZoomIn, Share2, Loader2, Image as ImageIcon } from 'lucide-react';

interface Plan {
  displayName: string; planLabel: string;
  bedrooms: number | null; bathrooms: number | null;
  sqftMin: number; sqftMax: number; sqmMin: number; sqmMax: number;
  priceFrom: number | null; unitCount: number; sampleUnitId: number; floorPlanUrl: string | null;
}
interface PropOpt { id: number; buildingName: string }
interface Resp { properties: PropOpt[]; selectedPropertyId: number | null; plans: Plan[] }

const aed = (n: number) => new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(n);
const bedLabel = (b: number | null) => (b == null ? 'Unit' : b === 0 ? 'Studio' : `${b} Bed`);
const sizeLabel = (a: number, b: number) => (a === b ? `${a.toLocaleString()}` : `${a.toLocaleString()} - ${b.toLocaleString()}`);

export default function FloorPlansPage() {
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [beds, setBeds] = useState('all');
  const [baths, setBaths] = useState('all');
  const [price, setPrice] = useState('all');

  const load = useCallback((pid?: number | null) => {
    setLoading(true);
    fetch(`/api/listings/floor-plans${pid ? `?propertyId=${pid}` : ''}`)
      .then(r => r.json()).then((d: Resp) => { setData(d); setPropertyId(d.selectedPropertyId); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const plans = data?.plans ?? [];
  const bedOpts = useMemo(() => [...new Set(plans.map(p => p.bedrooms).filter(b => b != null))].sort((a, b) => (a as number) - (b as number)), [plans]);
  const bathOpts = useMemo(() => [...new Set(plans.map(p => p.bathrooms).filter(b => b != null))].sort((a, b) => (a as number) - (b as number)), [plans]);

  const filtered = plans.filter(p => {
    if (beds !== 'all' && String(p.bedrooms) !== beds) return false;
    if (baths !== 'all' && String(p.bathrooms) !== baths) return false;
    if (price !== 'all' && p.priceFrom != null) {
      const [lo, hi] = price.split('-').map(Number);
      if (p.priceFrom < lo || (hi && p.priceFrom > hi)) return false;
    }
    return true;
  });

  const share = async (p: Plan) => {
    const url = `${location.origin}/listings/units/${p.sampleUnitId}`;
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-5 py-8">
        <h1 className="text-2xl font-bold text-[#14201a]">Floor plans</h1>
        {data && data.properties.length > 0 && (
          <p className="text-sm text-[#5f6b63] mt-1">{data.properties.find(p => p.id === propertyId)?.buildingName?.trim()}</p>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mt-5">
          {data && data.properties.length > 1 && (
            <Select label="Building" value={String(propertyId ?? '')} onChange={v => { setPropertyId(Number(v)); load(Number(v)); }}
              options={data.properties.map(p => ({ value: String(p.id), label: p.buildingName.trim() }))} />
          )}
          <Select label="Bedrooms" value={beds} onChange={setBeds}
            options={[{ value: 'all', label: 'All' }, ...bedOpts.map(b => ({ value: String(b), label: bedLabel(b as number) }))]} />
          <Select label="Bathrooms" value={baths} onChange={setBaths}
            options={[{ value: 'all', label: 'All' }, ...bathOpts.map(b => ({ value: String(b), label: `${b} Bath` }))]} />
          <Select label="Price" value={price} onChange={setPrice}
            options={[{ value: 'all', label: 'All' }, { value: '0-60000', label: '≤ 60k' }, { value: '60000-90000', label: '60k–90k' }, { value: '90000-', label: '90k+' }]} />
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-[#8a948d]"><Loader2 size={16} className="animate-spin" /> Loading floor plans…</div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-[#8a948d] py-24">No floor plans match these filters.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12 mt-10">
            {filtered.map(p => (
              <div key={p.planLabel} className="flex flex-col items-center text-center">
                {/* Floor plan image */}
                <div className="w-full aspect-[4/3] flex items-center justify-center bg-[#f6f8f6] rounded-sm overflow-hidden">
                  <PlanThumb url={p.floorPlanUrl} alt={p.displayName} />
                </div>

                {/* Zoom / share */}
                <div className="flex items-center gap-3 my-4">
                  {p.floorPlanUrl && (
                    <a href={p.floorPlanUrl} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full border border-[#e4e9e5] flex items-center justify-center text-[#5f6b63] hover:bg-[#f7f6f2]" title="Zoom">
                      <ZoomIn size={15} />
                    </a>
                  )}
                  <button onClick={() => share(p)} className="w-9 h-9 rounded-full border border-[#e4e9e5] flex items-center justify-center text-[#5f6b63] hover:bg-[#f7f6f2]" title="Copy link">
                    <Share2 size={15} />
                  </button>
                </div>

                <p className="text-sm font-semibold tracking-[0.15em] text-[#14201a] uppercase">{p.displayName}</p>
                <p className="text-base font-bold text-[#14201a] mt-2">
                  {bedLabel(p.bedrooms)}{p.bathrooms != null ? ` / ${p.bathrooms} Bath` : ''}
                </p>
                <p className="text-sm text-[#5f6b63] mt-1.5">{sizeLabel(p.sqftMin, p.sqftMax)} Sq. Ft.</p>
                {p.priceFrom != null && <p className="text-sm text-[#5f6b63]">Starting at AED {aed(p.priceFrom)}/yr</p>}

                <Link href={`/listings/units/${p.sampleUnitId}`}
                  className="mt-4 inline-block px-7 py-2.5 rounded-full border border-[#14201a] text-xs font-semibold tracking-wider uppercase text-[#14201a] hover:bg-[#14201a] hover:text-white transition-colors">
                  View availability
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Floor plans are stored as PDFs (and occasionally images). An <img> can't
 * render a PDF, so detect by extension and use an <iframe> for PDFs.
 */
const isPdf = (u: string) => /\.pdf(\?|$)/i.test(u);
function PlanThumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return (
    <div className="flex flex-col items-center text-[#c5c3bc]"><ImageIcon size={32} /><span className="text-xs mt-1">No floor plan</span></div>
  );
  if (isPdf(url)) return (
    <iframe
      src={`${url}#toolbar=0&navpanes=0&view=FitH`}
      title={alt}
      className="w-full h-full pointer-events-none"
      style={{ border: 0 }}
    />
  );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="max-w-full max-h-full object-contain" />;
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="appearance-none border border-[#d8d6d0] rounded-md pl-3 pr-9 py-2 text-sm text-[#14201a] bg-white focus:outline-none focus:border-[#047246] cursor-pointer">
        {options.map(o => <option key={o.value} value={o.value}>{label === 'Bedrooms' || label === 'Bathrooms' || label === 'Price' ? (o.value === 'all' ? label : o.label) : o.label}</option>)}
      </select>
      <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a948d] pointer-events-none" />
    </div>
  );
}
