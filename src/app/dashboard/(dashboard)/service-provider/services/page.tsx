/**
 * SP "My Services" — the provider's service listings, wired to the SP catalog
 * API (SP Sprint 1, SCRUM-372/382/385). Grouped by main category with a
 * Row · Grid view toggle; availability toggle + price display + delete-while-
 * pending. Adding happens on the /services/new picker.
 *
 * Styled to design 2a (the SP live dashboard / job-ready vocabulary): Schibsted
 * Grotesk, #F5F7F4 canvas, #E4E7E2 / radius-14 cards, ink #182420, green
 * #0B7A4E — so it reads as one system with the rest of the SP portal.
 *
 * GATE 1: activating a listing 403s until the account is compliance-approved
 * (server-enforced); GATE 2: new/edited listings sit 'pending' until admin
 * approval.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Schibsted_Grotesk } from 'next/font/google';
import { Briefcase, LayoutGrid, Loader2, Plus, Rows3, ShieldCheck, Trash2 } from 'lucide-react';
import { apiGet, apiPatch, apiDelete } from '@/lib/api';
import {
  SpCapabilityChecklist,
  SpToolsChip,
  declareCapability,
  declareCapabilityMine,
  fetchMyCategoryChecklists,
  fetchMyChecklists,
  removeCapabilityPhoto,
  removeCapabilityPhotoMine,
  summariseRows,
  uploadCapabilityPhoto,
  uploadCapabilityPhotoMine,
  type CategoryChecklist,
  type ListingChecklist,
} from '@/components/upnow/SpCapabilityChecklist';

const grotesk = Schibsted_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

/* ── Tokens (design 2a) ──────────────────────────────────────────────────── */
const GREEN = '#0B7A4E';
const INK = '#182420';
const MUTE = '#55645B';
const FAINT = '#8A968D';
const FAINTER = '#B7C0BA';
const CANVAS = '#F5F7F4';
const BORDER = '1px solid #E4E7E2';
const HAIRLINE = '1px solid #EEF1EE';
const TRACK = '#E4E7E2';
const TINT_GREEN = '#E9F4EE';

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
  approved: { bg: TINT_GREEN, fg: GREEN,     label: 'Approved' },
  pending:  { bg: '#FEF6E7',  fg: '#92400E', label: 'In review' },
  rejected: { bg: '#FDECEC',  fg: '#B42318', label: 'Rejected' },
};

const CATEGORY_LABELS: Record<string, string> = {
  home_cleaning: 'Home Cleaning', ac_services: 'AC Services', plumbing: 'Plumbing',
  electrical: 'Electrical', handyman: 'Handyman', painting: 'Painting',
  pest_control: 'Pest Control', car_vehicle: 'Car & Vehicle',
  landscaping_outdoor: 'Landscaping & Outdoor', commercial_services: 'Commercial Services',
};

// Canonical display order for the category sections (unknowns fall to the end).
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

const VIEW_STORAGE_KEY = 'sp-services-view';

function priceLabel(s: SpService): string {
  if (s.pricingMode === 'quote' || s.basePrice == null) return 'Quote';
  const base = `AED ${Number(s.basePrice).toLocaleString('en-AE')}`;
  const suffix = s.priceUnit === 'per_hour' ? '/hr' : '';
  return `${s.isFromPrice !== false ? 'From ' : ''}${base}${suffix}`;
}

function catLabel(category?: string | null): string {
  return CATEGORY_LABELS[category ?? ''] ?? category ?? 'Other';
}

export default function SpMyServicesPage() {
  const [services, setServices] = useState<SpService[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'row' | 'grid'>('row');

  // Restore the last-used view (persisted like the RP portfolio toggle). Must
  // be an effect, not a lazy initializer — reading localStorage during render
  // would hydration-mismatch (server has no window). Same trade-off as the SP
  // Settings ?tab= restore.
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_STORAGE_KEY) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'row' || saved === 'grid') setView(saved);
  }, []);

  const setViewPersist = (v: 'row' | 'grid') => {
    setView(v);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* ignore */ }
  };

  // SP-248 → SP-268: the tools & materials a CATEGORY needs, declared ONCE per
  // provider — shown on the category header. A listing only carries its own
  // EXTRAS (rare). Advisory — the page still works if this fails to load.
  const [checklists, setChecklists] = useState<Record<number, ListingChecklist>>({});
  const [catChecklists, setCatChecklists] = useState<Record<string, CategoryChecklist>>({});
  const [openChecklist, setOpenChecklist] = useState<number | null>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState<number | null>(null);
  const [declaringCat, setDeclaringCat] = useState<string | null>(null);
  const loadChecklists = () =>
    Promise.all([
      fetchMyChecklists()
        .then((rows) => setChecklists(Object.fromEntries(rows.map((r) => [r.serviceCatalogId, r]))))
        .catch(() => {}),
      fetchMyCategoryChecklists()
        .then((rows) => setCatChecklists(Object.fromEntries(rows.map((r) => [r.categoryCode, r]))))
        .catch(() => {}),
    ]);

  const load = () =>
    Promise.all([
      apiGet<SpService[] | { data?: SpService[] }>('/service-provider/services')
        .then((d) => setServices(Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : [])))
        .catch(() => setServices([])),
      loadChecklists(),
    ]);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const declare = async (listingId: number, requirementId: number, declared: boolean, note?: string | null) => {
    setDeclaring(listingId);
    setError(null);
    try {
      await declareCapability(listingId, requirementId, declared, note);
      // SP-268: a tool is declared once per provider — the tick shows on every
      // listing in the category, so refresh them all, not just this one.
      await loadChecklists();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your declaration');
    } finally {
      setDeclaring(null);
    }
  };

  // Group by main category, ordered canonically; unknown categories last (A–Z).
  const groups = useMemo(() => {
    const map = new Map<string, SpService[]>();
    for (const s of services) {
      const key = s.category ?? 'other';
      (map.get(key) ?? map.set(key, []).get(key)!).push(s);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return catLabel(a).localeCompare(catLabel(b));
    });
  }, [services]);

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

  const AvailabilitySwitch = ({ s }: { s: SpService }) => (
    <button
      type="button"
      onClick={() => toggle(s)}
      disabled={busy === s.id}
      title={s.isAvailable ? 'Available — click to pause' : 'Paused — click to activate'}
      aria-pressed={Boolean(s.isAvailable)}
      style={{
        position: 'relative', width: 36, height: 20, borderRadius: 999, flexShrink: 0,
        border: 0, cursor: 'pointer', transition: 'background .15s',
        background: s.isAvailable ? GREEN : TRACK,
      }}
    >
      <span style={{ position: 'absolute', top: 2, left: s.isAvailable ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(20,40,30,.25)' }} />
    </button>
  );

  const DeleteButton = ({ s }: { s: SpService }) =>
    (s.listingStatus ?? 'pending').toLowerCase() !== 'approved' ? (
      <button
        type="button"
        onClick={() => remove(s)}
        disabled={busy === s.id}
        title="Remove"
        style={{ padding: 6, borderRadius: 8, border: 0, background: 'transparent', color: FAINTER, cursor: 'pointer', display: 'flex' }}
      >
        {busy === s.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
      </button>
    ) : null;

  const StatusPill = ({ s }: { s: SpService }) => {
    const tone = STATUS_STYLE[(s.listingStatus ?? 'pending').toLowerCase()] ?? STATUS_STYLE.pending;
    return (
      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: tone.bg, color: tone.fg, whiteSpace: 'nowrap' }}>
        {tone.label}
      </span>
    );
  };

  const declareCat = async (code: string, requirementId: number, declared: boolean, note?: string | null) => {
    setDeclaringCat(code);
    setError(null);
    try {
      await declareCapabilityMine(requirementId, declared, note);
      await loadChecklists();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your declaration');
    } finally {
      setDeclaringCat(null);
    }
  };

  /** SP-268 — the CATEGORY's tools & materials: chip on the group header, checklist under it. */
  const CategoryTools = ({ code }: { code: string }) => {
    const cl = catChecklists[code];
    if (!cl || cl.summary.total === 0) return null;
    return (
      <SpToolsChip checklist={cl} open={openCategory === code} onToggle={() => setOpenCategory(openCategory === code ? null : code)} />
    );
  };
  const CategoryChecklistPanel = ({ code, label }: { code: string; label: string }) =>
    openCategory === code && catChecklists[code] ? (
      <div style={{ ...cardStyle(), overflow: 'hidden', marginBottom: 10 }}>
        <SpCapabilityChecklist
          checklist={catChecklists[code]}
          busy={declaringCat === code}
          intro={`Tools & materials every ${label} service needs. Tick what you have and add a photo of each — declared once, it counts for all ${catChecklists[code].listingCount} of your ${label} services. UpNow verifies them at review.`}
          onDeclare={(requirementId, declared, note) => void declareCat(code, requirementId, declared, note)}
          onUploadPhoto={async (requirementId, file) => { await uploadCapabilityPhotoMine(requirementId, file); await loadChecklists(); }}
          onRemovePhoto={async (requirementId) => { await removeCapabilityPhotoMine(requirementId); await loadChecklists(); }}
        />
      </div>
    ) : null;

  /** A listing's own EXTRAS (template-scoped) — rare; the category list lives on the header. */
  const extrasOf = (s: SpService) => {
    const rows = (checklists[s.id]?.rows ?? []).filter((r) => r.scope === 'template');
    return rows.length ? { rows, summary: summariseRows(rows) } : undefined;
  };
  const ToolsChip = ({ s }: { s: SpService }) => {
    const ex = extrasOf(s);
    if (!ex) return null;
    return (
      <span title="Extra tools only this service needs (on top of the category list)">
        <SpToolsChip checklist={ex} open={openChecklist === s.id} onToggle={() => setOpenChecklist(openChecklist === s.id ? null : s.id)} />
      </span>
    );
  };
  const Checklist = ({ s }: { s: SpService }) => {
    const ex = extrasOf(s);
    return openChecklist === s.id && ex ? (
      <SpCapabilityChecklist
        checklist={ex}
        busy={declaring === s.id}
        intro="Extra tools only this service needs, on top of the category list."
        onDeclare={(requirementId, declared, note) => void declare(s.id, requirementId, declared, note)}
        onUploadPhoto={async (requirementId, file) => { await uploadCapabilityPhoto(s.id, requirementId, file); await loadChecklists(); }}
        onRemovePhoto={async (requirementId) => { await removeCapabilityPhoto(s.id, requirementId); await loadChecklists(); }}
      />
    ) : null;
  };

  const Price = ({ s }: { s: SpService }) => (
    <span
      title={s.pricingMode === 'quote' ? 'Priced per job via quotes' : 'Price set by UpNow'}
      style={{ fontSize: 13.5, fontWeight: 700, color: INK, whiteSpace: 'nowrap' }}
    >
      {priceLabel(s)}
    </span>
  );

  return (
    <div className={grotesk.className} style={{ background: CANVAS, minHeight: '100%', color: INK }}>
      <div className="max-w-5xl mx-auto" style={{ padding: '26px 20px 40px' }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap" style={{ marginBottom: 22 }}>
          <div style={{ maxWidth: 620 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.015em', color: INK }}>My Services</h1>
            <p style={{ fontSize: 13, color: MUTE, marginTop: 5, lineHeight: 1.5 }}>
              The services you offer, adopted from the UpNow catalog. Prices are set by UpNow —
              you control which services you offer and their availability. New listings are
              reviewed by UpNow before going live.
            </p>
          </div>
          <Link
            href="/dashboard/service-provider/services/new"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 16px',
              borderRadius: 11, background: GREEN, color: '#fff', fontSize: 13.5, fontWeight: 600,
              whiteSpace: 'nowrap', boxShadow: '0 5px 14px -7px rgba(11,122,78,.55)',
            }}
          >
            <Plus size={16} /> Add from catalog
          </Link>
        </div>

        {error && (
          <div style={{ borderRadius: 12, padding: '11px 15px', marginBottom: 16, fontSize: 13, background: '#FDECEC', color: '#B42318', border: '1px solid #F5C6C6' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ ...cardStyle(), padding: 40, textAlign: 'center', fontSize: 13, color: FAINT }}>Loading services…</div>
        ) : services.length === 0 ? (
          <div style={{ ...cardStyle(), padding: 48, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: TINT_GREEN }}>
              <Briefcase size={24} style={{ color: GREEN }} />
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: INK }}>No services yet</h2>
            <p style={{ fontSize: 13, maxWidth: 420, margin: '0 auto', color: MUTE, lineHeight: 1.5 }}>
              Pick the services you offer from the UpNow catalog and submit them for review.
              Prices are set by UpNow. Approved services appear to customers and start receiving bookings.
            </p>
            <Link
              href="/dashboard/service-provider/services/new"
              style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', borderRadius: 11, background: GREEN, color: '#fff', fontSize: 13.5, fontWeight: 600 }}
            >
              <Plus size={16} /> Browse the catalog
            </Link>
            <p style={{ fontSize: 12, marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center', color: FAINT }}>
              <ShieldCheck size={13} /> Your account must be compliance-approved before services go live.
            </p>
          </div>
        ) : (
          <>
            {/* Summary + view toggle */}
            <div className="flex items-center justify-between gap-4 flex-wrap" style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 13, color: MUTE }}>
                <span style={{ fontWeight: 700, color: INK }}>{services.length}</span>
                {` service${services.length === 1 ? '' : 's'} across `}
                <span style={{ fontWeight: 700, color: INK }}>{groups.length}</span>
                {` categor${groups.length === 1 ? 'y' : 'ies'}`}
              </p>
              <div style={{ display: 'flex', background: '#EDF0EC', borderRadius: 10, padding: 3 }}>
                {([['row', Rows3, 'Row'], ['grid', LayoutGrid, 'Grid']] as const).map(([v, Icon, label]) => {
                  const active = view === v;
                  return (
                    <button
                      key={v} type="button" onClick={() => setViewPersist(v)} title={`${label} view`} aria-pressed={active}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700,
                        padding: '6px 13px', borderRadius: 8, cursor: 'pointer', border: 0,
                        color: active ? INK : FAINT, background: active ? '#fff' : 'transparent',
                        boxShadow: active ? '0 1px 3px rgba(20,40,30,.12)' : 'none',
                      }}
                    >
                      <Icon size={14} /> {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category sections */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
              {groups.map(([category, items]) => {
                const availableCount = items.filter((s) => s.isAvailable).length;
                return (
                  <section key={category}>
                    <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 11, paddingLeft: 2 }}>
                      <h2 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', color: INK }}>{catLabel(category)}</h2>
                      <span style={{ fontSize: 12, color: FAINT }}>
                        {items.length} service{items.length === 1 ? '' : 's'}
                        {availableCount > 0 ? ` · ${availableCount} available` : ''}
                      </span>
                      {/* SP-268 — the tools & materials list lives on the CATEGORY, declared once for all its services */}
                      <span style={{ marginLeft: 'auto' }}><CategoryTools code={category} /></span>
                    </div>
                    <CategoryChecklistPanel code={category} label={catLabel(category)} />

                    {view === 'row' ? (
                      <div style={{ ...cardStyle(), overflow: 'hidden' }}>
                        {items.map((s, i) => (
                          <div key={s.id} style={{ borderTop: i ? HAIRLINE : undefined }}>
                            <div className="flex items-center gap-4 flex-wrap" style={{ padding: '13px 16px' }}>
                              <div className="flex-1" style={{ minWidth: 160, fontSize: 14, fontWeight: 600, color: INK }}>
                                {s.name ?? '—'}
                              </div>
                              <ToolsChip s={s} />
                              <Price s={s} />
                              <StatusPill s={s} />
                              <AvailabilitySwitch s={s} />
                              <DeleteButton s={s} />
                            </div>
                            <Checklist s={s} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                        {items.map((s) => (
                          <div key={s.id} style={{ ...cardStyle(), padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div className="flex items-start justify-between gap-2">
                              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, color: INK }}>{s.name ?? '—'}</div>
                              <StatusPill s={s} />
                            </div>
                            <Price s={s} />
                            <div><ToolsChip s={s} /></div>
                            <Checklist s={s} />
                            <div className="flex items-center justify-between" style={{ marginTop: 'auto', paddingTop: 2 }}>
                              <div className="flex items-center gap-2">
                                <AvailabilitySwitch s={s} />
                                <span style={{ fontSize: 12, color: MUTE }}>{s.isAvailable ? 'Available' : 'Paused'}</span>
                              </div>
                              <DeleteButton s={s} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const cardStyle = (): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14 });
