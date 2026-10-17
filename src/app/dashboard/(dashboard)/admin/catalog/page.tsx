'use client';

/**
 * Super-Admin › Categories › Service catalog (dashboard/admin/catalog)
 *
 * Root-configuration console for the platform-owned SP rate card: categories, service templates
 * (prices), packages/variants, add-ons, capability requirements, commission (global + per-category
 * overrides, versioned in fee_config), VAT display mode, launch scope, cancellation and payout policy.
 * All money is WHOLE AED (not fils); commission/VAT stored as basis points.
 * Backend contract: /admin/catalog/* — tolerate 404/network (may not be live).
 *
 * Parity with previous page:
 *  - GET /admin/catalog/overview + GET /admin/catalog/templates?includeInactive=1 (Promise.allSettled,
 *    silent re-load after every mutation; load error banner with Retry).                        ✓ kept
 *  - Deep-link ?category=<code> selects that category once on mount; default selection = first category. ✓ kept
 *  - KPIs: active categories x/y, live services (+ total templates), pricing mix, default commission
 *    (+ override count).                                                                      ✓ kept (+ provider adoptions, real sum)
 *  - Category list: select, drag-to-reorder (PATCH /admin/catalog/categories/:id {sortOrder}, only moved
 *    rows), image/icon, Off badge, active service count, commission + override marker, Edit, "New".  ✓ kept (kit table)
 *  - Services list for selected category: drag-to-reorder (PATCH /admin/catalog/templates/:id {sortOrder}),
 *    image, Arabic name, Emergency / own cancellation / callout / adoptions / quantity / extras chips,
 *    duration, price pill, active toggle (PATCH /admin/catalog/templates/:id {isActive}, optimistic +
 *    rollback), Edit, "Add service".                                                          ✓ kept (kit table; + name search, drag off while searching)
 *  - Packages column (variant ladder + booking options, Edit → ServiceModal focus='packages',
 *    "Add packages")                                                                          ✓ kept → now a kit Drawer opened by "Packages"
 *  - Chart "Catalog shape by category" (recharts, click bar to filter)                         ~ replaced by kit Bars
 *    (active services + from-price per category); filtering is done from the Categories table.
 *  - Platform defaults: CommissionCard (PATCH /admin/catalog/commission, DELETE /admin/catalog/commission/:id),
 *    VatCard (PATCH /admin/catalog/policies vat_display_mode), LaunchCancellationCard (PATCH policies
 *    sp_launch / cancellation_policy), PayoutScheduleCard (SP-221).                            ✓ REUSED unchanged
 *  - CategoryModal (POST/PATCH categories, image upload/remove, RequirementsEditor) and ServiceModal
 *    (POST/PATCH templates, image, VariantsEditor, AddonsEditor, RequirementsEditor, cancellation override). ✓ REUSED unchanged (./_parts.tsx)
 *  - Confirm dialog for every policy/commission change (busy + error state).                  ✓ kept → kit Modal
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import {
  Bars, Btn, Callout, Card, Drawer, EmptyRow, ErrorRow, KV, Kpi, Kpis, Modal, OsPage, PageHead, Pill,
  ScopeStrip, SearchField, SkeletonRows, StatusTag, TableWrap, type Tone,
} from '@/components/os/kit';
import { apiGet, apiPatch } from '@/lib/api';
import { PayoutScheduleCard } from '@/components/upnow/PayoutScheduleCard';
import {
  type CatCategory, type CommissionResult, type Overview, type Template,
  CategoryModal, CommissionCard, EMIRATES, LaunchCancellationCard, ServiceModal, Toggle, VatCard,
  fmtAED, fmtBps, fmtDuration, iconFor, pricePill, templateDuration,
} from './_parts';

const PILL_TONE: Record<'green' | 'amber' | 'mute', Tone> = { green: 'primary', amber: 'amber', mute: 'neutral' };
const PRICE_UNIT_LABEL: Record<string, string> = {
  fixed: 'Fixed price', per_hour: 'Per hour', per_unit: 'Per unit', per_area: 'Per area',
  per_size_package: 'Per size package', per_period: 'Per period', quote_after_callout: 'Quote after callout',
};

export default function AdminCatalogPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  // The service whose package ladder is shown in the drawer.
  const [selectedTplId, setSelectedTplId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  // Drag-to-reorder (native HTML5).
  const [dragCatId, setDragCatId] = useState<number | null>(null);
  const [dragSvcId, setDragSvcId] = useState<number | null>(null);
  const deepLinkCode = useRef<string | null>(null);

  /* Modals + confirm */
  const [catModal, setCatModal] = useState<{ cat: CatCategory | null } | null>(null);
  const [svcModal, setSvcModal] = useState<{ tpl: Template | null; focus?: 'packages' } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<void> } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const categories = useMemo(() => overview?.categories ?? [], [overview]);

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) { setLoading(true); setLoadError(null); }
    const [ov, tpl] = await Promise.allSettled([
      apiGet<Overview>('/admin/catalog/overview'),
      apiGet<{ data: Template[] }>('/admin/catalog/templates?includeInactive=1'),
    ]);
    if (ov.status === 'fulfilled' && ov.value && Array.isArray(ov.value.categories)) {
      setOverview(ov.value);
      if (deepLinkCode.current) {
        const hit = ov.value.categories.find(c => c.code === deepLinkCode.current);
        if (hit) setSelectedCatId(hit.id);
        deepLinkCode.current = null;
      }
    } else if (ov.status === 'rejected' && !opts?.silent) {
      setLoadError(ov.reason instanceof Error ? ov.reason.message : 'Could not reach the catalog service.');
    }
    if (tpl.status === 'fulfilled' && Array.isArray(tpl.value?.data)) setTemplates(tpl.value.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Deep-link ?category=<code> — read once on mount.
    try { deepLinkCode.current = new URLSearchParams(window.location.search).get('category'); } catch { /* ignore */ }
    // Deferred one microtask so the initial fetch's state updates don't run synchronously in the effect.
    void Promise.resolve().then(() => loadAll());
  }, [loadAll]);

  /* ── Derived values ── */
  const activeTemplates = useMemo(() => templates.filter(t => t.isActive), [templates]);
  const pricingMix = useMemo(() => {
    let fixed = 0, hourly = 0, quote = 0;
    for (const t of activeTemplates) {
      if (t.priceUnit === 'quote_after_callout') quote++;
      else if (t.priceUnit === 'per_hour') hourly++;
      else fixed++;
    }
    return { fixed, hourly, quote };
  }, [activeTemplates]);
  const adoptions = useMemo(() => templates.reduce((s, t) => s + (t.adoptionCount || 0), 0), [templates]);

  // No "All categories" view — default to the first category (derived, so no effect needed).
  const effectiveCatId = selectedCatId ?? categories[0]?.id ?? null;

  const visibleTemplates = useMemo(
    () => (effectiveCatId == null ? templates : templates.filter(t => t.categoryId === effectiveCatId)),
    [templates, effectiveCatId],
  );
  const searching = q.trim().length > 0;
  const shownTemplates = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return visibleTemplates;
    return visibleTemplates.filter(t => [t.name, t.nameAr ?? '', t.code].some(x => x.toLowerCase().includes(s)));
  }, [visibleTemplates, q]);
  const selectedCat = effectiveCatId == null ? null : categories.find(c => c.id === effectiveCatId) ?? null;
  const drawerTpl = templates.find(t => t.id === selectedTplId) ?? null;

  const selectCategory = (id: number) => {
    setSelectedCatId(id);
    // Switching category clears a packages selection that is no longer visible.
    setSelectedTplId(prev => (prev != null && templates.some(t => t.id === prev && t.categoryId === id) ? prev : null));
  };

  /** Persist a new order: renumber 1..n and PATCH only the rows that moved. */
  const persistOrder = async (rows: { id: number; sortOrder: number }[], pathFor: (id: number) => string) => {
    const changed = rows.filter((r, i) => r.sortOrder !== i + 1);
    await Promise.all(changed.map(r => apiPatch(pathFor(r.id), { sortOrder: rows.indexOf(r) + 1 })));
  };

  const dropCategory = async (targetId: number) => {
    if (dragCatId == null || dragCatId === targetId) { setDragCatId(null); return; }
    const list = [...categories];
    const from = list.findIndex(c => c.id === dragCatId);
    const to = list.findIndex(c => c.id === targetId);
    if (from < 0 || to < 0) { setDragCatId(null); return; }
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    setOverview(prev => prev ? { ...prev, categories: list.map((c, i) => ({ ...c, sortOrder: i + 1 })) } : prev);
    setDragCatId(null);
    try { await persistOrder(list, id => `/admin/catalog/categories/${id}`); } catch { /* order re-syncs on next load */ }
  };

  const dropService = async (targetId: number) => {
    if (dragSvcId == null || dragSvcId === targetId) { setDragSvcId(null); return; }
    const list = [...visibleTemplates];
    const from = list.findIndex(t => t.id === dragSvcId);
    const to = list.findIndex(t => t.id === targetId);
    if (from < 0 || to < 0) { setDragSvcId(null); return; }
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    const renumbered = new Map(list.map((t, i) => [t.id, i + 1]));
    setTemplates(prev => prev.map(t => renumbered.has(t.id) ? { ...t, sortOrder: renumbered.get(t.id)! } : t)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
    setDragSvcId(null);
    try { await persistOrder(list, id => `/admin/catalog/templates/${id}`); } catch { /* re-syncs on next load */ }
  };

  /* ── Mutations ── */
  async function toggleTemplateActive(t: Template) {
    const next = !t.isActive;
    setTemplates(prev => prev.map(x => (x.id === t.id ? { ...x, isActive: next } : x)));
    try {
      await apiPatch(`/admin/catalog/templates/${t.id}`, { isActive: next });
      void loadAll({ silent: true });
    } catch {
      setTemplates(prev => prev.map(x => (x.id === t.id ? { ...x, isActive: !next } : x)));
    }
  }

  function applyCommissionResult(res: CommissionResult) {
    setOverview(prev => {
      if (!prev) return prev;
      const byId = new Map(res.categories.map(c => [c.id, c]));
      return {
        ...prev,
        commission: { ...prev.commission, globalBps: res.globalBps },
        categories: prev.categories.map(c => {
          const u = byId.get(c.id);
          return u ? { ...c, commissionBps: u.commissionBps, hasOverride: u.hasOverride } : c;
        }),
      };
    });
  }

  const requestConfirm = (message: string, run: () => Promise<void>) => {
    setConfirmError(null);
    setConfirm({ message, run });
  };
  const closeConfirm = useCallback(() => { if (!confirmBusy) setConfirm(null); }, [confirmBusy]);
  const closeDrawer = useCallback(() => setSelectedTplId(null), []);
  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true); setConfirmError(null);
    try { await confirm.run(); setConfirm(null); }
    catch (e) { setConfirmError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setConfirmBusy(false); }
  };

  const chartRows = useMemo(() => {
    const active = categories.filter(c => c.isActive);
    const max = Math.max(1, ...active.map(c => c.activeServiceCount));
    return active.map(c => ({
      l: c.nameEn,
      pct: (c.activeServiceCount / max) * 100,
      v: `${c.activeServiceCount} · ${c.minFromPrice ? `from ${fmtAED(c.minFromPrice)}` : '—'}`,
    }));
  }, [categories]);

  const vatMode = overview?.policies?.vat_display_mode ?? 'inclusive';
  const launch = overview?.policies?.sp_launch;
  const liveEmirates = launch?.emirates?.map(e => EMIRATES.find(x => x.value === e)?.label ?? e).join(', ');
  const overrideCount = categories.filter(c => c.hasOverride).length;

  /* ════════ Render ════════ */
  return (
    <>
      <OsPage>
        <PageHead
          eyebrow="Admin › Categories"
          title="Service catalog"
          lede="The platform-owned rate card for home services. Providers adopt these services — you own the categories, prices, commission and marketplace policies from here."
          actions={<>
            <Btn size="sm" onClick={() => void loadAll()} disabled={loading}>Refresh</Btn>
            <Btn size="sm" onClick={() => setCatModal({ cat: null })}>New category</Btn>
            <Btn size="sm" variant="primary" onClick={() => setSvcModal({ tpl: null })}>Add service</Btn>
          </>}
        />
        <ScopeStrip items={[
          { label: 'Workspace', value: 'Admin · Categories' },
          { label: 'Vertical', value: 'Home services' },
          { label: 'VAT display', value: overview ? (vatMode === 'net' ? 'Net + VAT' : 'VAT-inclusive') : '—' },
          { label: 'Live emirates', value: liveEmirates || '—' },
          { label: 'Onboarding', value: launch ? (launch.inviteOnly ? 'Invite-only' : 'Open') : '—' },
        ]} />

        {loadError && (
          <div style={{ marginBottom: 14 }}>
            <Callout tone="bad" title="Catalog service unavailable.">
              {loadError}. The backend may still be deploying.{' '}
              <Btn size="xs" onClick={() => void loadAll()}>Retry</Btn>
            </Callout>
          </div>
        )}

        <Kpis>
          <Kpi k="Active categories" v={overview ? `${categories.filter(c => c.isActive).length}/${categories.length}` : '—'} d="of taxonomy" />
          <Kpi k="Live services" v={overview || templates.length ? activeTemplates.length : '—'} d={`${templates.length} total templates`} />
          <Kpi k="Pricing mix" v={templates.length ? `${pricingMix.fixed} fixed` : '—'}
            d={templates.length ? `${pricingMix.hourly} hourly · ${pricingMix.quote} quote` : undefined} />
          <Kpi dark k="Default commission" v={overview ? fmtBps(overview.commission.globalBps) : '—'}
            d={`${overrideCount} category override${overrideCount === 1 ? '' : 's'}`} />
          <Kpi k="Provider adoptions" v={templates.length ? adoptions : '—'} d="across all services" />
        </Kpis>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)] gap-[14px] items-start" style={{ marginBottom: 14 }}>
          {/* Categories */}
          <Card title="Categories" sub="Drag rows to reorder. Select a category to see its services." right={
            <Btn size="xs" onClick={() => setCatModal({ cat: null })}>New category</Btn>
          }>
            <TableWrap>
              <table className="gx-tbl">
                <thead><tr><th aria-label="Reorder" /><th>Category</th><th>Status</th><th className="num">Services</th><th className="num">Commission</th><th className="act">Actions</th></tr></thead>
                {loading && !overview ? <SkeletonRows rows={6} cols={6} />
                  : loadError && !overview ? <ErrorRow cols={6} onRetry={() => void loadAll()} />
                  : categories.length === 0 ? <EmptyRow cols={6} title="No categories yet" text="Create the first category with “New category”." />
                  : (
                    <tbody>
                      {categories.map(cat => {
                        const Icon = iconFor(cat.iconKey);
                        const selected = effectiveCatId === cat.id;
                        return (
                          <tr key={cat.id}
                            className="click"
                            draggable
                            onDragStart={() => setDragCatId(cat.id)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => void dropCategory(cat.id)}
                            onDragEnd={() => setDragCatId(null)}
                            onClick={() => selectCategory(cat.id)}
                            style={{
                              background: selected ? '#eef7f2' : undefined,
                              opacity: dragCatId === cat.id ? 0.4 : cat.isActive ? 1 : 0.6,
                              cursor: 'grab',
                            }}
                          >
                            <td style={{ width: 18 }}><GripVertical size={13} aria-hidden style={{ color: '#c9c6bf' }} /></td>
                            <td className="strong">
                              <span className="flex items-center gap-2">
                                {cat.imageUrl
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={cat.imageUrl} alt="" className="h-5 w-5 rounded object-cover flex-shrink-0" />
                                  : <Icon size={15} aria-hidden style={{ color: selected ? '#047246' : '#8a948d' }} />}
                                <span className="truncate">{cat.nameEn}</span>
                              </span>
                              <div className="sub">{cat.minFromPrice ? `from ${fmtAED(cat.minFromPrice)}` : cat.code}</div>
                            </td>
                            <td>{cat.isActive ? <StatusTag status="active" /> : <StatusTag status="inactive" label="Off" />}</td>
                            <td className="num">{cat.activeServiceCount}<span className="sub"> / {cat.serviceCount}</span></td>
                            <td className="num nowrap">
                              {fmtBps(cat.commissionBps)}
                              {cat.hasOverride && <> <Pill tone="amber" dot={false}>Override</Pill></>}
                            </td>
                            <td className="act" onClick={e => e.stopPropagation()}>
                              <span className="gx-btn-row" style={{ justifyContent: 'flex-end' }}>
                                {!selected && <Btn size="xs" onClick={() => selectCategory(cat.id)}>Services</Btn>}
                                <Btn size="xs" onClick={() => setCatModal({ cat })}>Edit</Btn>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  )}
              </table>
            </TableWrap>
          </Card>

          {/* Services of the selected category */}
          <Card
            title={selectedCat ? `${selectedCat.nameEn} services` : 'Services'}
            sub={`${visibleTemplates.length} service${visibleTemplates.length === 1 ? '' : 's'}${searching ? ' · reordering is off while searching' : ' · drag rows to reorder'}`}
            right={<Btn size="xs" variant="primary" onClick={() => setSvcModal({ tpl: null })}>Add service</Btn>}
          >
            <TableWrap toolbar={<SearchField value={q} onChange={setQ} placeholder="Search services in this category" />}>
              <table className="gx-tbl">
                <thead><tr><th aria-label="Reorder" /><th>Service</th><th>Price</th><th className="nowrap">Duration</th><th>Status</th><th className="act">Actions</th></tr></thead>
                {loading && !templates.length ? <SkeletonRows rows={6} cols={6} />
                  : shownTemplates.length === 0 ? (
                    <EmptyRow cols={6}
                      title={searching ? 'No services match' : 'No services here yet'}
                      text={searching ? 'Clear the search to see every service in this category.' : 'Add the first one with “Add service” — providers will adopt it at your price.'} />
                  ) : (
                    <tbody>
                      {shownTemplates.map(t => {
                        const pill = pricePill(t);
                        const activeAddons = t.addons?.filter(a => a.isActive).length ?? 0;
                        return (
                          <tr key={t.id}
                            draggable={!searching}
                            onDragStart={() => setDragSvcId(t.id)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => void dropService(t.id)}
                            onDragEnd={() => setDragSvcId(null)}
                            style={{
                              background: selectedTplId === t.id ? '#eef7f2' : undefined,
                              opacity: dragSvcId === t.id ? 0.4 : t.isActive ? 1 : 0.6,
                              cursor: searching ? undefined : 'grab',
                            }}
                          >
                            <td style={{ width: 18 }}>{!searching && <GripVertical size={13} aria-hidden style={{ color: '#c9c6bf' }} />}</td>
                            <td>
                              <span className="flex items-center gap-2">
                                {t.imageUrl && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={t.imageUrl} alt="" className="h-7 w-10 rounded-md object-cover flex-shrink-0" />
                                )}
                                <span className="min-w-0">
                                  <span className="strong" style={{ fontWeight: 600 }}>{t.name}</span>
                                  {t.nameAr && <span className="sub" dir="rtl" style={{ marginLeft: 6 }}>{t.nameAr}</span>}
                                  <span className="flex flex-wrap gap-1" style={{ marginTop: 3 }}>
                                    {t.isEmergency && <Pill tone="danger" dot={false}>Emergency</Pill>}
                                    {t.cancellationPolicy?.cancel && <Pill tone="amber" dot={false}>Own cancellation terms</Pill>}
                                    {t.minCalloutCharge != null && t.minCalloutCharge > 0 && <Pill tone="info" dot={false}>Callout {fmtAED(t.minCalloutCharge)}</Pill>}
                                    {t.adoptionCount > 0 && <Pill dot={false}>{t.adoptionCount} provider{t.adoptionCount === 1 ? '' : 's'}</Pill>}
                                    {t.quantityLabel && <Pill tone="info" dot={false}>Asks: {t.quantityLabel}</Pill>}
                                    {activeAddons > 0 && <Pill tone="info" dot={false}>+{activeAddons} extra{activeAddons === 1 ? '' : 's'}</Pill>}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td><Pill tone={PILL_TONE[pill.tone]} dot={false}>{pill.text}</Pill></td>
                            <td className="mono nowrap">{templateDuration(t)}</td>
                            <td className="nowrap">
                              <span className="flex items-center gap-2">
                                <Toggle on={t.isActive} onChange={() => void toggleTemplateActive(t)} />
                                {t.isActive ? <StatusTag status="active" label="Live" /> : <StatusTag status="inactive" label="Off" />}
                              </span>
                            </td>
                            <td className="act">
                              <span className="gx-btn-row" style={{ justifyContent: 'flex-end' }}>
                                <Btn size="xs" onClick={() => setSelectedTplId(t.id)}>Packages</Btn>
                                <Btn size="xs" onClick={() => setSvcModal({ tpl: t })}>Edit</Btn>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  )}
              </table>
            </TableWrap>
          </Card>
        </div>

        <Card title="Catalog shape by category" sub="Active services per active category, with the cheapest ‘from’ price. Select a category in the table above to filter." pad>
          {chartRows.length === 0
            ? <div className="gx-empty"><b>No active categories to chart yet.</b></div>
            : <Bars rows={chartRows} />}
        </Card>

        <div style={{ margin: '14px 0' }} className="space-y-2">
          <Callout tone="info" title="Whole AED, basis points.">
            Catalog prices are whole dirhams; commission and VAT are stored as basis points. The ‘from’ price of a packaged service auto-tracks its cheapest active package.
          </Callout>
          <Callout tone="warn" title="Changes apply to new bookings only.">
            Commission is versioned in fee_config. Bookings keep the commission, cancellation and payout terms they were made under. A service can override the platform cancellation matrix on its own row.
          </Callout>
        </div>

        <div className="gx-eyebrow" style={{ margin: '22px 0 8px' }}>Platform defaults · root configuration</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <CommissionCard overview={overview} onConfirm={requestConfirm} applyResult={applyCommissionResult} />
          <VatCard overview={overview} onConfirm={requestConfirm} setOverview={setOverview} />
          <LaunchCancellationCard overview={overview} onConfirm={requestConfirm} setOverview={setOverview} />
          {/* SP-221 · payout hold / cadence / minimum */}
          <PayoutScheduleCard onConfirm={requestConfirm} />
        </div>
      </OsPage>

      {/* ── Package ladder drawer (was the third browser column) ── */}
      <Drawer
        open={drawerTpl != null}
        onClose={closeDrawer}
        title={drawerTpl ? (drawerTpl.variantGroupLabel || 'Packages') : 'Packages'}
        sub={drawerTpl ? `${categories.find(c => c.id === drawerTpl.categoryId)?.nameEn ?? drawerTpl.categoryCode} → ${drawerTpl.name}` : undefined}
        footer={drawerTpl && <>
          {drawerTpl.priceUnit !== 'quote_after_callout' && (
            <Btn variant="primary" onClick={() => { setSvcModal({ tpl: drawerTpl, focus: 'packages' }); closeDrawer(); }}>
              {(drawerTpl.variants?.length ?? 0) > 0 ? 'Edit packages' : 'Add packages'}
            </Btn>
          )}
          <Btn onClick={() => { setSvcModal({ tpl: drawerTpl }); closeDrawer(); }}>Edit service</Btn>
          <Btn onClick={closeDrawer}>Close</Btn>
        </>}
      >
        {drawerTpl && (() => {
          const tpl = drawerTpl;
          const pkgs = (tpl.variants ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
          const dur = templateDuration(tpl);
          return (
            <div className="space-y-3">
              <KV items={[
                { k: 'Pricing', v: PRICE_UNIT_LABEL[tpl.priceUnit] ?? tpl.priceUnit },
                {
                  k: 'Price',
                  v: tpl.priceUnit === 'quote_after_callout'
                    ? 'Free quote — priced after the visit'
                    : tpl.priceUnit === 'per_hour'
                      ? `AED ${tpl.basePrice ?? '—'} per hour`
                      : `${tpl.isFromPrice ? 'From ' : ''}AED ${tpl.basePrice ?? '—'}`,
                },
                { k: 'Duration', v: dur },
                { k: 'Status', v: tpl.isActive ? <StatusTag status="active" label="Live" /> : <StatusTag status="inactive" label="Off" /> },
              ]} />
              {pkgs.length === 0 ? (
                <Callout tone="info">
                  {tpl.priceUnit === 'quote_after_callout'
                    ? 'Priced by quote — free-quote services don’t use packages.'
                    : `Single price — ${tpl.basePrice != null ? fmtAED(tpl.basePrice) : '—'}, no packages.`}
                </Callout>
              ) : (
                <TableWrap>
                  <table className="gx-tbl">
                    <thead><tr><th>Package</th><th>Duration</th><th>Status</th><th className="num">Price</th></tr></thead>
                    <tbody>
                      {pkgs.map(v => (
                        <tr key={v.id} style={{ opacity: v.isActive ? 1 : 0.6 }}>
                          <td className="strong">{v.name}</td>
                          <td className="mono nowrap">{(v.estimatedDuration || v.estimatedDurationMax) ? fmtDuration(v.estimatedDuration, v.estimatedDurationMax) : '—'}</td>
                          <td>{v.isActive ? <StatusTag status="active" /> : <StatusTag status="inactive" label="Off" />}</td>
                          <td className="num nowrap">{fmtAED(v.basePrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              {pkgs.length > 0 && <div className="gx-hint">From-price auto-tracks the cheapest active package · edit rows via “Edit packages”.</div>}
              {(tpl.quantityLabel || (tpl.addons?.length ?? 0) > 0) && (
                <Card title="Booking options">
                  <TableWrap>
                    <table className="gx-tbl">
                      <tbody>
                        {tpl.quantityLabel && (
                          <tr><td className="strong">{tpl.quantityLabel}</td><td className="num">{tpl.quantityMin ?? 1}–{tpl.quantityMax ?? '∞'}</td></tr>
                        )}
                        {(tpl.addons ?? []).map(a => (
                          <tr key={a.id} style={{ opacity: a.isActive ? 1 : 0.6 }}>
                            <td>{a.name}{!a.isActive && <> <Pill dot={false}>Off</Pill></>}</td>
                            <td className="num nowrap">+{fmtAED(a.price)}{a.priceUnit === 'per_hour' ? '/hr' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                </Card>
              )}
            </div>
          );
        })()}
      </Drawer>

      {/* ── Editors (reused verbatim from the previous page) ── */}
      {catModal && (
        <CategoryModal
          cat={catModal.cat}
          nextSortOrder={categories.length ? Math.max(...categories.map(c => c.sortOrder)) + 1 : 1}
          onClose={() => setCatModal(null)}
          onSaved={() => { setCatModal(null); void loadAll({ silent: true }); }}
          onRefetch={() => void loadAll({ silent: true })}
        />
      )}
      {svcModal && (
        <ServiceModal
          tpl={svcModal.tpl}
          focus={svcModal.focus}
          categories={categories}
          defaultCategoryId={effectiveCatId}
          nextSortOrder={Math.max(0, ...templates.filter(t => t.categoryId === (svcModal.tpl?.categoryId ?? effectiveCatId)).map(t => t.sortOrder)) + 1}
          onClose={() => setSvcModal(null)}
          onSaved={() => { setSvcModal(null); void loadAll({ silent: true }); }}
          onRefetch={() => void loadAll({ silent: true })}
        />
      )}
      <Modal
        open={confirm != null}
        onClose={closeConfirm}
        title="Please confirm"
        footer={<>
          <Btn onClick={closeConfirm} disabled={confirmBusy}>Cancel</Btn>
          <Btn variant="primary" onClick={() => void runConfirm()} disabled={confirmBusy}>{confirmBusy ? 'Saving…' : 'Confirm'}</Btn>
        </>}
      >
        <p>{confirm?.message}</p>
        {confirmError && <div className="gx-err" role="alert" style={{ marginTop: 8 }}>{confirmError}</div>}
      </Modal>
    </>
  );
}
