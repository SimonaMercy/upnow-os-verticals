/**
 * Settings → Maintenance — deliberately SIMPLE (owner-directed 31 Aug 2026,
 * simplified again the same day): ONE list — the items the landlord PAYS FOR
 * during a tenancy, and who does each. Nothing else is configured here:
 * anything not listed is decided per request when it comes in (and that
 * decision can be saved as a rule from the request). Saves on every change —
 * no draft state, no Save button. Scope by property type or a single
 * property when needed.
 *
 * What is deliberately NOT here: provider linking (AMC & Vendors carries the
 * "Use for routing" toggle — a one-line pointer replaces the old card),
 * thresholds / per-item providers / customer notes (the data model keeps
 * them; the API accepts them; the UI stays out of the way). The item list
 * itself is managed on the Maintenance List page.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X, Loader2, Wrench, Star, Trash2 } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';

interface Cat { id: number; name: string; parentId?: number | null; own?: boolean }
interface LinkRow { serviceProviderId: number; name: string; relationship: string; isDefault: boolean }
interface Rule {
  id?: number; serviceCategoryId: number; coverage: 'covered' | 'chargeable' | 'not_offered';
  approvalThresholdAed: number | null; preferredServiceProviderId: number | null;
  notes: string | null; propertyId?: number | null; propertyType?: string | null;
}
interface Payload {
  categories: Cat[]; providers: LinkRow[];
  properties: { id: number; buildingName: string; spaceCategory?: string | null }[];
  defaults: Rule[];
  byType?: (Rule & { propertyType: string })[];
  overrides: (Rule & { propertyId: number })[];
}

const PROPERTY_TYPES = ['residential', 'commercial', 'industrial'] as const;
type PropertyType = (typeof PROPERTY_TYPES)[number];
/** Coverage is PER PROPERTY TYPE (owner, 31 Aug: landlords cover residential
 *  tenancies; commercial/industrial carry their own) — a type tab is always
 *  selected; a single property can override its type's list. */
type Scope = `type:${PropertyType}` | number;
const TYPE_LABEL: Record<PropertyType, string> = { residential: 'Residential', commercial: 'Commercial', industrial: 'Industrial' };
const TYPE_EMPTY: Record<PropertyType, string> = {
  residential: 'Nothing listed yet — add the items you pay for, or prefill the standard tenancy terms.',
  commercial: 'Nothing listed — commercial tenancies usually carry their own maintenance. Leave this empty and any request from a commercial unit comes to you to decide.',
  industrial: 'Nothing listed — industrial tenancies usually carry their own maintenance. Leave this empty and any request from an industrial unit comes to you to decide.',
};

/** The standard tenancy contract's split (categories seeded in 0252/0253). */
const STANDARD: Record<string, Rule['coverage']> = {
  'Water leakage — kitchen & bathroom': 'covered',
  'Drainage problems': 'covered',
  'Mold, moisture & fungus on walls': 'covered',
  'A/C system maintenance': 'covered',
  'Pest control — on request': 'covered',
  'Exhaust fan, water heater & cooker hood': 'covered',
  'Clogged sinks & drain cleaning': 'chargeable',
  'Doors, windows, handles & locks': 'chargeable',
  'Electric switches': 'chargeable',
  'Fused light bulbs': 'chargeable',
  'A/C internal components': 'chargeable',
  'Kitchen cabinets': 'chargeable',
  'Bathroom sanitary fittings': 'chargeable',
  'Leaking taps': 'chargeable',
};

const field = 'border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';

/** `manager={{ rp }}` swaps every call to the landlord-scoped
 *  /manager/maintenance/*?rp= mirror (gated by canManageMaintenance), and the
 *  vendor list to /manager/amc/vendors/all — the same swap AmcView makes. */
export function MaintenanceCoveragePanel({ manager }: { manager?: { rp: number } } = {}) {
  const u = useCallback((path: string) => manager
    ? `/manager/maintenance${path}${path.includes('?') ? '&' : '?'}rp=${manager.rp}`
    : `/maintenance${path}`, [manager]);
  const vendorsUrl = manager ? `/manager/amc/vendors/all?rp=${manager.rp}` : '/amc/vendors/all';
  const [data, setData] = useState<Payload | null>(null);
  const [scope, setScope] = useState<Scope>('type:residential');
  const [lastType, setLastType] = useState<PropertyType>('residential');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [managingProviders, setManagingProviders] = useState(false);
  const [allVendors, setAllVendors] = useState<{ id: number; name: string }[]>([]);

  const scopeType: PropertyType | null =
    typeof scope === 'string' && scope.startsWith('type:') ? (scope.slice(5) as PropertyType) : null;

  const load = useCallback(() => {
    apiGet<Payload>(u('/policies')).then(setData).catch(() => setError('Could not load the coverage settings.'));
  }, [u]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (managingProviders && !allVendors.length) {
      apiGet<{ id: number; name: string }[]>(vendorsUrl)
        .then(v => setAllVendors(Array.isArray(v) ? v : [])).catch(() => {});
    }
  }, [managingProviders, allVendors.length, vendorsUrl]);

  const scopeBody = scopeType ? { propertyType: scopeType } : { propertyId: scope as number };
  const rulesAtScope = useMemo(() => {
    if (!data) return [];
    if (scopeType) return (data.byType ?? []).filter(r => r.propertyType === scopeType);
    return data.overrides.filter(r => r.propertyId === scope);
  }, [data, scope, scopeType]);

  const catById = useMemo(() => new Map((data?.categories ?? []).map(c => [c.id, c])), [data]);
  const groupOf = (c?: Cat) => (c?.parentId != null ? catById.get(c.parentId)?.name ?? '' : '');

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); load(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work — try again.'); }
    finally { setBusy(false); }
  };

  /** The provider a category is set to — the one every item of the group
   *  shares; null when unset or (legacy) mixed. */
  const groupProviderOf = (groupId: number): number | null => {
    const ids = new Set(rulesAtScope.filter(r => catById.get(r.serviceCategoryId)?.parentId === groupId).map(r => r.preferredServiceProviderId ?? 0));
    return ids.size === 1 ? ([...ids][0] || null) : null;
  };

  /** One rule saved the moment it changes — a new item inherits its category's
   *  provider; existing extras (threshold/notes) are preserved. */
  const setCoverage = (categoryId: number, coverage: Rule['coverage'], existing?: Rule) =>
    act(() => apiPut(u('/policies'), {
      ...scopeBody,
      rules: [{
        serviceCategoryId: categoryId, coverage,
        approvalThresholdAed: existing?.approvalThresholdAed ?? null,
        preferredServiceProviderId: existing?.preferredServiceProviderId
          ?? (catById.get(categoryId)?.parentId != null ? groupProviderOf(catById.get(categoryId)!.parentId!) : null),
        notes: existing?.notes ?? null,
      }],
    }));

  const removeRule = (r: Rule) => { if (r.id != null) void act(() => apiDelete(u(`/policies/${r.id}`))); };

  /** One vendor for a whole group ("Electrical → volt co") in one click —
   *  writes every configured rule of that group in a single call. */
  const setGroupProvider = (groupId: number, providerId: number | null) => {
    const rules = rulesAtScope.filter(r => catById.get(r.serviceCategoryId)?.parentId === groupId);
    if (!rules.length) return;
    void act(() => apiPut(u('/policies'), {
      ...scopeBody,
      rules: rules.map(r => ({
        serviceCategoryId: r.serviceCategoryId, coverage: r.coverage,
        approvalThresholdAed: r.approvalThresholdAed ?? null,
        preferredServiceProviderId: providerId,
        notes: r.notes ?? null,
      })),
    }));
  };

  /** One default for all — the same star the AMC & Vendors page sets. */
  const setDefaultProvider = (serviceProviderId: number) =>
    act(() => apiPost(u('/links'), { serviceProviderId, isDefault: true }));

  const prefill = () => {
    if (!data) return;
    // Only what the contract puts on the LANDLORD — the tenant-side items are
    // not configured here.
    const rules = data.categories
      .filter(c => c.parentId != null && STANDARD[c.name] === 'covered')
      .map(c => ({
        serviceCategoryId: c.id, coverage: 'covered' as const,
        approvalThresholdAed: null, preferredServiceProviderId: null,
        notes: c.name === 'Exhaust fan, water heater & cooker hood'
          ? 'Replaced or repaired once for new tenants (building only); any later repair is the tenant’s.'
          : null,
      }));
    void act(() => apiPut(u('/policies'), { ...scopeBody, rules }));
  };

  if (!data) return <div className="bg-white rounded-2xl p-6 shadow-sm text-sm text-[#9b9890]">{error ?? 'Loading coverage…'}</div>;

  const configured = new Set(rulesAtScope.map(r => r.serviceCategoryId));
  const addable = data.categories.filter(c => c.parentId != null && !configured.has(c.id));
  const groups = data.categories.filter(g => g.parentId == null);
  const defaultProvider = data.providers.find(p => p.isDefault) ?? data.providers[0] ?? null;
  const byName = (a: Rule, b: Rule) => {
    const ca = catById.get(a.serviceCategoryId), cb = catById.get(b.serviceCategoryId);
    return groupOf(ca).localeCompare(groupOf(cb)) || (ca?.name ?? '').localeCompare(cb?.name ?? '');
  };
  // The list IS the covered items. Decisions saved from a request (customer
  // pays / not offered) are not configured here, only shown so they can be
  // removed.
  const sortedRules = rulesAtScope.filter(r => r.coverage === 'covered').sort(byName);
  const otherRules = rulesAtScope.filter(r => r.coverage !== 'covered').sort(byName);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-bold text-[#1a1916]">Maintenance coverage</h2>
          <p className="text-xs text-[#6b6860] mt-1 max-w-[64ch]">
            Per property type: the items you pay for during a tenancy, and which provider handles each
            category. Anything not listed comes to you per request to decide.
          </p>
        </div>
        <label className="text-[10px] font-bold uppercase tracking-wide text-[#9b9890]">
          <span className="block mb-1">Override for one property</span>
          <select value={typeof scope === 'number' ? String(scope) : ''} disabled={busy}
            onChange={e => setScope(e.target.value ? Number(e.target.value) : (`type:${lastType}` as Scope))}
            className={field + ' font-normal normal-case tracking-normal'}>
            <option value="">None — by property type</option>
            {data.properties.map(p => (
              <option key={p.id} value={p.id}>
                {p.buildingName}{p.spaceCategory ? ` · ${p.spaceCategory === 'mixed_use' ? 'mixed-use' : p.spaceCategory}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* The primary axis: one list per property type. */}
      <div className="inline-flex items-center gap-1 mt-3 p-1 rounded-xl bg-[#f4f3ef]">
        {PROPERTY_TYPES.map(t => (
          <button key={t} type="button" disabled={busy}
            onClick={() => { setLastType(t); setScope(`type:${t}` as Scope); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${scopeType === t ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-white'}`}>
            {TYPE_LABEL[t]}
            <span className={scopeType === t ? ' opacity-80' : ' text-[#9b9890]'}> · {(data.byType ?? []).filter(r => r.propertyType === t && r.coverage === 'covered').length}</span>
          </button>
        ))}
        {typeof scope === 'number' && (() => {
          const prop = data.properties.find(p => p.id === scope);
          const mixed = prop?.spaceCategory === 'mixed_use';
          return (
            <span className="text-[11px] text-[#92400e] font-semibold px-2">
              {mixed
                ? 'Mixed-use building — this list applies to EVERY unit in it, shops and flats alike; leave it empty to keep resolving each unit by its own type.'
                : `Editing one property — overrides its ${prop?.spaceCategory ?? 'type'} list`}
            </span>
          );
        })()}
      </div>

      {/* who does the work — one default for everything, overridable per item below */}
      <div className="text-xs text-[#6b6860] mt-2.5 flex items-center gap-2 flex-wrap">
        <Wrench size={12} className="text-[#1a7a5a]" />
        {data.providers.length ? (
          <>
            <span>Covered work goes to</span>
            <select value={defaultProvider?.serviceProviderId ?? ''} disabled={busy}
              onChange={e => { const id = Number(e.target.value); if (id) void setDefaultProvider(id); }}
              className={field + ' !py-1 !text-xs font-semibold'}>
              {data.providers.map(pr => (
                <option key={pr.serviceProviderId} value={pr.serviceProviderId}>
                  {pr.name}{pr.relationship === 'internal_team' ? ' · own team' : ''}
                </option>
              ))}
            </select>
            <span>unless a category says otherwise.</span>
          </>
        ) : (
          <span className="font-semibold text-[#b45309]">No provider linked yet — requests will wait.</span>
        )}
        <button type="button" onClick={() => setManagingProviders(true)}
          className="text-[#1a7a5a] font-semibold underline cursor-pointer">
          {data.providers.length ? 'manage providers' : 'Link a provider'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-[#fef2f2] rounded-lg px-3 py-2 mt-3">{error}</p>}

      <ul className="mt-4 divide-y divide-[#f4f3ef] border-t border-b border-[#f4f3ef]">
        {groups.flatMap(g => {
          const groupRules = sortedRules.filter(r => catById.get(r.serviceCategoryId)?.parentId === g.id);
          if (!groupRules.length) return [];
          // The group's common provider — '' when the rows disagree.
          const provs = new Set(groupRules.map(r => r.preferredServiceProviderId ?? 0));
          const common = provs.size === 1 ? [...provs][0] : null;
          return [
            <li key={`g-${g.id}`} className="flex items-center gap-3 py-2 bg-[#fafaf8] -mx-6 px-6">
              <span className="flex-1 text-[11px] font-bold uppercase tracking-wide text-[#1a7a5a]">{g.name}</span>
              {data.providers.length > 0 && (
                <label className="flex items-center gap-1.5 text-[10px] text-[#9b9890] shrink-0">
                  provider
                  <select disabled={busy}
                    value={common == null ? '__mixed' : common === 0 ? '' : String(common)}
                    onChange={e => { if (e.target.value !== '__mixed') void setGroupProvider(g.id, e.target.value ? Number(e.target.value) : null); }}
                    title={`Which provider handles ${g.name}`}
                    className={field + ' !py-0.5 !text-[11px] max-w-[180px]'}>
                    {common == null && <option value="__mixed">mixed…</option>}
                    <option value="">Default{defaultProvider ? ` — ${defaultProvider.name}` : ''}</option>
                    {data.providers.map(pr => (
                      <option key={pr.serviceProviderId} value={pr.serviceProviderId}>{pr.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <span className="w-[14px] shrink-0" />
            </li>,
            ...groupRules.map(r => {
          const cat = catById.get(r.serviceCategoryId);
          return (
            <li key={r.serviceCategoryId} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0 pl-2">
                <span className="text-sm font-medium text-[#1a1916]">{cat?.name ?? `Item #${r.serviceCategoryId}`}</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#1a7a5a] bg-[#d8f2e8] px-2 py-0.5 rounded-full shrink-0">Landlord pays</span>
              <button type="button" disabled={busy} onClick={() => removeRule(r)}
                title="Remove — falls back to per-request review"
                className="text-[#c5c2bc] hover:text-[#b91c1c] cursor-pointer shrink-0"><X size={14} /></button>
            </li>
          );
            }),
          ];
        })}
        {sortedRules.length === 0 && (
          <li className="py-4 text-sm text-[#9b9890]">
            {scopeType ? TYPE_EMPTY[scopeType] : 'Nothing listed for this property — it follows its property type\u2019s list. Add items only to differ from it.'}
          </li>
        )}
      </ul>

      {otherRules.length > 0 && (
        <div className="mt-3 text-[11px] text-[#6b6860]">
          <span className="font-semibold">Decided per request and saved as rules:</span>{' '}
          {otherRules.map(r => (
            <span key={r.serviceCategoryId} className="inline-flex items-center gap-1 border border-[#e8e6e0] rounded-full pl-2 pr-1 py-0.5 mr-1.5 mb-1">
              {catById.get(r.serviceCategoryId)?.name ?? `Item #${r.serviceCategoryId}`} · {r.coverage === 'chargeable' ? 'customer pays' : 'not offered'}
              <button type="button" disabled={busy} onClick={() => removeRule(r)} title="Remove — back to deciding per request" className="text-[#c5c2bc] hover:text-[#b91c1c] cursor-pointer"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <select value={adding} onChange={e => {
          const id = Number(e.target.value);
          setAdding('');
          if (id) void setCoverage(id, 'covered');
        }} disabled={busy} className={field}>
          <option value="">{busy ? 'Saving…' : '+ Add an item you pay for…'}</option>
          {groups.map(g => {
            const kids = addable.filter(c => c.parentId === g.id);
            if (!kids.length) return null;
            return (
              <optgroup key={g.id} label={g.name}>
                {kids.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            );
          })}
        </select>
        <button type="button" onClick={prefill} disabled={busy}
          title="Fill this scope with what the standard tenancy contract puts on the landlord — leakage, drainage, mold, A/C system, pest control, the one-time appliances."
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[#cfe7dc] text-[#1a7a5a] bg-[#f0faf6] hover:bg-[#d8f2e8] cursor-pointer disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Prefill standard tenancy terms
        </button>
      </div>

      {managingProviders && (
        <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={busy ? undefined : () => setManagingProviders(false)}>
          <div className="w-[min(460px,100%)] bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-[#2e9f82] text-white px-5 py-3.5">
              <div className="font-bold text-sm">Maintenance providers</div>
              <button onClick={() => setManagingProviders(false)} className="p-1 rounded-lg hover:bg-white/20" aria-label="Close"><X size={17} /></button>
            </div>
            <div className="p-5 space-y-2">
              {data.providers.map(pr => (
                <div key={pr.serviceProviderId} className="flex items-center gap-3 border border-[#e8e6e0] rounded-xl px-3.5 py-2.5">
                  <button type="button" disabled={busy || pr.isDefault} title={pr.isDefault ? 'Default provider' : 'Make default'}
                    onClick={() => void setDefaultProvider(pr.serviceProviderId)}
                    className="cursor-pointer disabled:cursor-default">
                    <Star size={15} className={pr.isDefault ? 'text-[#d97706] fill-[#f59e0b]' : 'text-[#c5c2bc]'} />
                  </button>
                  <span className="text-sm font-semibold text-[#1a1916] flex-1 min-w-0 truncate">{pr.name}</span>
                  <select value={pr.relationship} disabled={busy} className={field + ' !py-1 !text-xs'}
                    onChange={e => void act(() => apiPost(u('/links'), { serviceProviderId: pr.serviceProviderId, relationship: e.target.value }))}>
                    <option value="contracted_vendor">Contracted vendor</option>
                    <option value="internal_team">Our own team</option>
                  </select>
                  <button type="button" disabled={busy} title="Unlink"
                    onClick={() => { if (window.confirm(`Stop routing maintenance to ${pr.name}?`)) void act(() => apiDelete(u(`/links/${pr.serviceProviderId}`))); }}
                    className="text-[#9b9890] hover:text-[#b91c1c] cursor-pointer"><Trash2 size={14} /></button>
                </div>
              ))}
              {data.providers.length === 0 && (
                <p className="text-sm text-[#9b9890]">No providers linked yet — requests will wait until one is.</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <select id="link-provider-pick" defaultValue="" disabled={busy} className={field + ' flex-1'}>
                  <option value="">Link a provider…</option>
                  {allVendors.filter(v => !data.providers.some(pr => pr.serviceProviderId === v.id))
                    .map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <button type="button" disabled={busy}
                  onClick={() => {
                    const sel = document.getElementById('link-provider-pick') as HTMLSelectElement | null;
                    const id = Number(sel?.value ?? 0);
                    if (id) { void act(() => apiPost(u('/links'), { serviceProviderId: id })); if (sel) sel.value = ''; }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
                  <Plus size={13} /> Link
                </button>
              </div>
              <p className="text-[11px] text-[#9b9890]">A provider is a service-provider account on the platform — your own team registered as one, or a contracted vendor. The star is the default for all covered work.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
