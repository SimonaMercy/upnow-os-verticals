'use client';

/**
 * Catalogue › Subcategory declarations for a vertical. New page — no previous page to keep parity with.
 * Reads the catalog declarations (@/lib/catalog): listing fields (offer.filters), lead form and lifecycle.
 * No records are shown, but non-live subcategories are flagged Preview. Gate 2 lock for non-Spaces verticals.
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Btn, Callout, Card, EmptyRow, OsPage, PageHead, Pill, PreviewBanner, PreviewPill, ScopeStrip, Seg, TableWrap,
} from '@/components/os/kit';
import { isOfferLive, type MsFilterDef } from '@/lib/catalog';
import { RP_BASE } from '@/lib/os/scope';
import { RpServiceCatalogue } from '@/components/os/services/RpServiceCatalogue';
import { Gate2Lock, LifecycleFlow, useGate2, useVerticalParam } from '../../_parts';

const CONTROL: Record<string, string> = { select: 'Select', multi: 'Multi-select', toggle: 'Yes / No', date: 'Date', range: 'Range', seg: 'Segmented' };

function optionsSummary(f: MsFilterDef): string {
  if (!f.options.length) return '—';
  const shown = f.options.slice(0, 4).map((o) => o.l).join(', ');
  return f.options.length > 4 ? `${shown} +${f.options.length - 4} more` : shown;
}

export default function VerticalCataloguePage() {
  const vertical = useVerticalParam();
  const { locked } = useGate2(vertical.id);
  const sp = useSearchParams();
  const initial = vertical.offers.find((o) => o.id === sp?.get('sub'))?.id ?? vertical.offers[0]?.id ?? '';
  const [subId, setSubId] = useState(initial);
  const offer = vertical.offers.find((o) => o.id === subId) ?? vertical.offers[0];
  const anyPreview = vertical.offers.some((o) => !isOfferLive(vertical.id, o.id));

  // Services: a landlord reads the real public service catalogue (no subcategory declarations).
  if (vertical.id === 'services') return <RpServiceCatalogue />;

  if (locked) {
    return (
      <OsPage>
        <PageHead eyebrow="Catalogue" title={`${vertical.label} offerings`} />
        <Gate2Lock vertical={vertical} />
      </OsPage>
    );
  }

  const live = offer ? isOfferLive(vertical.id, offer.id) : false;
  return (
    <OsPage>
      <PageHead
        eyebrow="Catalogue"
        title={`${vertical.label} offerings`}
        lede="What each subcategory declares: the fields a listing must fill, the lead form a customer sees and the lifecycle a booking follows."
        actions={offer && <Btn variant="primary" href={`${RP_BASE}/v/${vertical.id}/listings/new?sub=${offer.id}`}>Create {offer.label} listing</Btn>}
      />
      {anyPreview && <PreviewBanner>Subcategories marked Preview have no backend yet — their declarations are shown so you can see what a listing will need. Nothing here is saved.</PreviewBanner>}
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Catalogue' },
        { label: 'Vertical', value: vertical.label },
        { label: 'Subcategories', value: vertical.offers.length },
        { label: 'Status', value: live ? <Pill tone="primary">Live</Pill> : <PreviewPill /> },
      ]} />
      <div style={{ marginBottom: 12, overflowX: 'auto' }}>
        <Seg label="Subcategory" value={offer?.id ?? ''} onChange={setSubId}
          options={vertical.offers.map((o) => ({ v: o.id, l: <>{o.label} {isOfferLive(vertical.id, o.id) ? <Pill tone="primary" dot={false}>Live</Pill> : <PreviewPill />}</> }))} />
      </div>
      {!offer ? (
        <Callout tone="warn" title="No subcategories declared.">This vertical has no catalog declarations yet.</Callout>
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <Callout tone="info" title={offer.label}>
              {offer.sub ?? offer.h1} · Price basis: <b>{offer.basis ?? 'not declared'}</b>
              {offer.permit && <> · Permit: <b>{offer.permit}</b></>}
            </Callout>
          </div>
          <div className="gx-cols gx-cols-2" style={{ marginBottom: 14 }}>
            <Card title="Listing fields" sub={`${offer.filters.length} declared field${offer.filters.length === 1 ? '' : 's'}`}>
              <TableWrap>
                <table className="gx-tbl">
                  <thead><tr><th>Field</th><th>Control</th><th>Unit</th><th>Options</th></tr></thead>
                  {offer.filters.length === 0 ? <EmptyRow cols={4} title="No fields declared" text="Specification gap — ask the catalogue owner to declare fields." /> : (
                    <tbody>
                      {offer.filters.map((f) => (
                        <tr key={f.id}>
                          <td className="strong">{f.label}<div className="sub mono">{f.id}{f.required ? ' · required' : ''}</div></td>
                          <td><Pill tone="outline" dot={false}>{CONTROL[f.type] ?? f.type}</Pill></td>
                          <td>{f.unit ?? '—'}</td>
                          <td>{optionsSummary(f)}</td>
                        </tr>
                      ))}
                    </tbody>
                  )}
                </table>
              </TableWrap>
            </Card>
            <Card title="Lead form & lifecycle" sub={offer.action ? `Primary action: ${offer.action}` : undefined} pad>
              <div className="gx-lb" style={{ marginBottom: 6 }}>Lead form</div>
              {offer.leadForm.length ? (
                <div className="gx-chips" style={{ marginBottom: 14 }}>
                  {offer.leadForm.map((f) => <Pill key={f.key} dot={false}>{f.label}</Pill>)}
                </div>
              ) : <p style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginBottom: 14 }}>No lead form declared.</p>}
              <div className="gx-lb" style={{ marginBottom: 6 }}>Lifecycle</div>
              <LifecycleFlow offer={offer} />
            </Card>
          </div>
        </>
      )}
    </OsPage>
  );
}
