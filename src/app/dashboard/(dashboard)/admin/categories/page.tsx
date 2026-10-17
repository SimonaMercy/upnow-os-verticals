'use client';

/**
 * Admin › Categories › Verticals & subcategories — Genspark OS rebuild.
 *
 * Read-only register of the 7 verticals / 35 subcategories as declared in MarketSpace
 * (synced by scripts/sync-marketspace-catalog.mjs into src/lib/catalog). For each
 * subcategory it shows whether the backend serves it today, what it is bound to, its price
 * basis, and the declared filters, lead form and lifecycle. Editing categories needs a
 * backend category API (not built) — the service catalog remains editable under
 * Categories › Service catalog.
 *
 * Parity with previous page (static catalog data, no API calls):
 *  - Subtitle counts: verticals · subcategories (SUBCATEGORY_COUNT) · live today.
 *  - "Edit service catalog" link → /dashboard/admin/catalog (head action).
 *  - Per vertical: label, Live / Coming soon (isVerticalLive), blurb — now a kit Card.
 *  - Per subcategory row: label, Live / Coming soon (isOfferLive), price basis, backend binding
 *    text (bindingOf: units category / space types, or service catalog codes; "—" when not live),
 *    filters count, lifecycle step count ("none" flagged).
 *  - Row expand (declared lifecycle, permit, primary action, filters/listing fields with type/unit/
 *    option count, lead form or "Default enquiry form", provider types) → now a labelled "Open"
 *    button opening a Drawer; lifecycle rendered as a kit Flow; missing lifecycle flagged as a gap.
 */
import { useCallback, useState } from 'react';
import {
  Btn, Callout, Card, Drawer, Flow, KV, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip,
} from '@/components/os/kit';
import {
  VERTICALS, SUBCATEGORY_COUNT, bindingOf, isOfferLive, isVerticalLive, type MsOffer, type MsVertical,
} from '@/lib/catalog';

function bindingText(v: MsVertical, o: MsOffer): string {
  const b = bindingOf(v.id, o.id);
  if (!b || !isVerticalLive(v.id)) return '—';
  if (b.kind === 'units') return b.category ? `Units · category ${b.category}` : `Units · ${b.spaceTypes!.join(', ')}`;
  return `Service catalog · ${b.categoryCodes.join(', ')}`;
}

const LivePill = ({ live }: { live: boolean }) =>
  live ? <Pill tone="primary">Live</Pill> : <Pill tone="amber">Coming soon</Pill>;

export default function AdminCategoriesPage() {
  const [sel, setSel] = useState<{ v: MsVertical; o: MsOffer } | null>(null);
  const close = useCallback(() => setSel(null), []);
  const liveCount = VERTICALS.reduce((n, v) => n + v.offers.filter((o) => isOfferLive(v.id, o.id)).length, 0);
  const liveVerticals = VERTICALS.filter((v) => isVerticalLive(v.id)).length;
  const gaps = VERTICALS.reduce((n, v) => n + v.offers.filter((o) => o.flow.length === 0).length, 0);

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Categories"
        title="Verticals & subcategories"
        lede={`${VERTICALS.length} verticals · ${SUBCATEGORY_COUNT} subcategories · ${liveCount} live today. Declarations are synced from MarketSpace; editing them needs a category API that does not exist yet.`}
        actions={<Btn size="sm" variant="primary" href="/dashboard/admin/catalog">Edit service catalog</Btn>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Categories' },
        { label: 'Source', value: 'MarketSpace declarations' },
        { label: 'Mode', value: 'Read-only' },
      ]} />

      <Kpis>
        <Kpi k="Verticals" v={VERTICALS.length} d={`${liveVerticals} live`} />
        <Kpi k="Subcategories" v={SUBCATEGORY_COUNT} />
        <Kpi k="Live today" v={liveCount} d="served by the backend" dark />
        <Kpi k="Lifecycle gaps" v={gaps} d="no declared lifecycle" />
      </Kpis>

      <div style={{ marginBottom: 14 }}>
        <Callout tone="info" title="Declared, not editable here.">
          Verticals, subcategories, filters, lead forms and lifecycles come from MarketSpace. The service catalog (what providers sell) stays editable under Service catalog.
        </Callout>
      </div>

      {VERTICALS.map((v) => (
        <div key={v.id} style={{ marginBottom: 14 }}>
          <Card
            title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{v.label} <LivePill live={isVerticalLive(v.id)} /></span>}
            sub={v.blurb}
            right={<span className="sub">{v.offers.length} subcategories</span>}
          >
            <div className="gx-tbl-scroll">
              <table className="gx-tbl">
                <thead>
                  <tr><th>Subcategory</th><th>Status</th><th>Price basis</th><th>Backend</th><th className="num">Filters</th><th className="num">Lifecycle steps</th><th className="act" /></tr>
                </thead>
                <tbody>
                  {v.offers.map((o) => (
                    <tr key={o.id} className="click" onClick={() => setSel({ v, o })}>
                      <td className="strong">{o.label}</td>
                      <td><LivePill live={isOfferLive(v.id, o.id)} /></td>
                      <td>{o.basis ?? '—'}</td>
                      <td className="mono">{bindingText(v, o)}</td>
                      <td className="num">{o.filters.length}</td>
                      <td className="num">{o.flow.length || <Pill tone="amber" dot={false}>None</Pill>}</td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <Btn size="xs" onClick={() => setSel({ v, o })}>Open</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ))}

      <Drawer
        open={sel != null}
        onClose={close}
        title={sel?.o.label ?? ''}
        sub={sel ? <>{sel.v.label} · <LivePill live={isOfferLive(sel.v.id, sel.o.id)} /></> : undefined}
        footer={<><Btn href="/dashboard/admin/catalog">Edit service catalog</Btn><Btn onClick={close}>Close</Btn></>}
      >
        {sel && (
          <>
            <KV items={[
              { k: 'Price basis', v: sel.o.basis ?? '—' },
              { k: 'Backend', v: <span className="mono">{bindingText(sel.v, sel.o)}</span> },
              { k: 'Permit', v: sel.o.permit ?? '—' },
              { k: 'Primary action', v: sel.o.action ?? '—' },
              { k: 'Provider types', v: sel.o.providerTypes.length ? sel.o.providerTypes.join(' · ') : '—' },
            ]} />

            <div style={{ marginTop: 14 }}>
              <Card title="Declared lifecycle" pad>
                {sel.o.flow.length
                  ? <Flow steps={sel.o.flow} />
                  : <Callout tone="warn" title="No lifecycle declared.">A specification gap to close before build.</Callout>}
              </Card>
            </div>

            <div style={{ marginTop: 14 }}>
              <Card title="Filters / listing fields" sub={`${sel.o.filters.length} declared`}>
                <div className="gx-tbl-scroll">
                  <table className="gx-tbl">
                    <thead><tr><th>Field</th><th>Type</th><th>Unit</th><th className="num">Options</th></tr></thead>
                    <tbody>
                      {sel.o.filters.length === 0 ? (
                        <tr><td colSpan={4} className="sub">No filters declared.</td></tr>
                      ) : sel.o.filters.map((d) => (
                        <tr key={d.id}>
                          <td className="strong">{d.label}</td>
                          <td className="mono">{d.type}</td>
                          <td>{d.unit ?? '—'}</td>
                          <td className="num">{d.options.length || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div style={{ marginTop: 14 }}>
              <Card title="Lead form">
                {sel.o.leadForm.length ? (
                  <div className="gx-tbl-scroll">
                    <table className="gx-tbl">
                      <thead><tr><th>Field</th><th>Type</th></tr></thead>
                      <tbody>
                        {sel.o.leadForm.map((f) => (
                          <tr key={f.key}><td className="strong">{f.label}</td><td className="mono">{f.type}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="gx-pad sub">Default enquiry form.</div>}
              </Card>
            </div>
          </>
        )}
      </Drawer>
    </OsPage>
  );
}
