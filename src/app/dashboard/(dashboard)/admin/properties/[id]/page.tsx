/**
 * Admin property detail (read-only) — SCRUM-588 click-through target.
 * Building info + owning RP + nested units (each unit drills through to unit detail).
 *
 * Parity with previous page (Genspark kit rebuild):
 *  - API: GET /admin/properties/:id. Error → "Property not found — <message>" with Back;
 *    loading state.
 *  - Header: building name, location (community, emirate → fallback full address), category,
 *    owner (RP) link → /dashboard/admin/users/:userId (plain name when no user).
 *  - Stats: Units, Listed (listingStatus=published), Occupancy (financials % + n/m, or occupied
 *    count), Available.
 *  - Market rent vs Annual rent (whole AED) with leased-units + % of asking — shown only when
 *    either is > 0. Vocabulary kept ("Market rent" / "Annual rent").
 *  - Unit mix by type (sorted desc), Property details (8 fields), Gym/Pool/Parking pills,
 *    map link (new tab), description.
 *  - Property documents: status pill, "View" → openDocViewer (view-only), "requested" when no file.
 *  - Units list → /dashboard/admin/units/:id (labelled "Open" + row click), rent, availability pill.
 *  - Back button (router.back()).
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { openDocViewer } from '@/lib/docViewer';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import {
  Bars, Btn, Callout, Card, Cols, EmptyRow, KV, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip, StatusTag, TableWrap,
  fmtAed, humanize,
} from '@/components/os/kit';

interface UnitRow {
  id: number; unitNumber: string | null; unitName: string | null; unitType: string | null;
  availability: string | null; rentalPrice: number | null; bedrooms: number | null; listingStatus: string | null;
}
interface PropertyDetail {
  property: {
    id: number; buildingName: string | null; fullAddress: string | null; spaceCategory: string | null;
    latitude: number | null; longitude: number | null;
    numberOfFloors: string | null; makaniNumber: string | null; plotNumber: string | null;
    mapLink: string | null; leasingType: string | null; propertyDescription: string | null;
    hasGym: boolean; hasPool: boolean; hasParking: boolean;
    emirate?: { nameEn?: string | null } | null; community?: { nameEn?: string | null } | null;
  };
  financials?: {
    marketPrice: number; annualRent: number; leasedUnits: number;
    occupiedUnits: number; totalUnits: number; occupancyPct: number;
  } | null;
  unitMix?: Record<string, number> | null;
  owner: { rentalProviderId: number; userId: number | null; name: string | null } | null;
  units: UnitRow[];
  documents: { id: number; documentKey: string; displayName: string | null; fileUrl: string | null; status: string | null }[];
}

/** Whole AED — money on units/leases is stored in AED, not fils. */
const aed = (n: number | null | undefined) => (n == null ? '—' : fmtAed(Math.round(Number(n))));
const bedsOf = (u: UnitRow) =>
  !isResidentialUnitType(u.unitType) || u.bedrooms == null ? null : u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} BR`;

export default function AdminPropertyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<PropertyDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    apiGet<PropertyDetail>(`/admin/properties/${params.id}`).then(setD).catch((e) => setErr(e?.message || 'Failed to load'));
  }, [params?.id]);

  const back = <Btn onClick={() => router.back()}>Back</Btn>;

  if (err) return (
    <OsPage>
      <PageHead eyebrow="Admin › Inventory" title="Property" actions={back} />
      <Callout tone="bad" title="Property not found.">{err}</Callout>
    </OsPage>
  );
  if (!d) return (
    <OsPage>
      <PageHead eyebrow="Admin › Inventory" title="Loading property…" actions={back} />
      <div className="gx-card gx-pad" aria-busy="true"><div className="gx-skel" style={{ height: 140 }} /></div>
    </OsPage>
  );

  const p = d.property;
  const loc = [p.community?.nameEn, p.emirate?.nameEn].filter(Boolean).join(', ') || p.fullAddress || '—';
  const units = d.units;
  const listed = units.filter((u) => u.listingStatus === 'published').length;
  const occupied = units.filter((u) => u.availability === 'occupied').length;
  const available = units.filter((u) => u.availability === 'available').length;
  const fin = d.financials ?? null;
  const mix = Object.entries(d.unitMix ?? {}).sort((a, b) => b[1] - a[1]);
  const mixMax = mix.reduce((m, [, c]) => Math.max(m, c), 0);

  const ownerNode = d.owner
    ? (d.owner.userId ? <Btn size="xs" href={`/dashboard/admin/users/${d.owner.userId}`}>{d.owner.name ?? 'Rental Provider'}</Btn> : (d.owner.name ?? '—'))
    : '—';

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Inventory"
        title={p.buildingName ?? 'Property'}
        lede={loc}
        actions={<>
          {back}
          {d.owner?.userId && <Btn href={`/dashboard/admin/users/${d.owner.userId}`}>Open owner</Btn>}
        </>}
      />
      <ScopeStrip items={[
        { label: 'Category', value: p.spaceCategory ? humanize(p.spaceCategory) : '—' },
        { label: 'Owner (RP)', value: ownerNode },
        { label: 'Units', value: units.length },
      ]} />

      <Kpis>
        <Kpi k="Units" v={units.length} />
        <Kpi k="Listed" v={listed} />
        <Kpi k="Occupancy" v={fin ? `${fin.occupancyPct}%` : occupied} d={fin ? `${fin.occupiedUnits}/${fin.totalUnits} occupied` : 'occupied'} dark />
        <Kpi k="Available" v={available} />
        {/* Market Rent is the asking rent across every unit; Annual Rent is what is actually
            contracted, counting one qualifying lease per unit — asking vs earning. These two
            names are the platform-wide vocabulary; do not reintroduce "market price" or
            "market value" for the same figure. */}
        {fin && (fin.marketPrice > 0 || fin.annualRent > 0) && <>
          <Kpi k="Market rent" v={aed(fin.marketPrice)} d={`asking rent · all ${fin.totalUnits} units`} />
          <Kpi k="Annual rent" v={aed(fin.annualRent)}
            d={`contracted · ${fin.leasedUnits} leased unit${fin.leasedUnits === 1 ? '' : 's'}${fin.marketPrice > 0 ? ` · ${Math.round((fin.annualRent / fin.marketPrice) * 100)}% of asking` : ''}`} />
        </>}
      </Kpis>

      <Cols kind={mix.length > 0 ? '2' : '2e'}>
        <Card title="Property details" pad>
          <KV items={[
            { k: 'Category', v: p.spaceCategory ? humanize(p.spaceCategory) : '—' },
            { k: 'Leasing type', v: p.leasingType ? humanize(p.leasingType) : '—' },
            { k: 'Emirate', v: p.emirate?.nameEn || '—' },
            { k: 'Community', v: p.community?.nameEn || '—' },
            { k: 'Makani', v: p.makaniNumber || '—' },
            { k: 'Plot no.', v: p.plotNumber || '—' },
            { k: 'Floors', v: p.numberOfFloors || '—' },
            { k: 'Full address', v: p.fullAddress || '—' },
          ]} />
          <div className="gx-btn-row" style={{ marginTop: 12 }}>
            {[{ label: 'Gym', on: p.hasGym }, { label: 'Pool', on: p.hasPool }, { label: 'Parking', on: p.hasParking }].map((a) => (
              <Pill key={a.label} tone={a.on ? 'primary' : 'neutral'}>{a.label}{a.on ? '' : ' — no'}</Pill>
            ))}
            {p.mapLink && <a href={p.mapLink} target="_blank" rel="noopener noreferrer" className="gx-btn xs">Open map ↗</a>}
          </div>
          {p.propertyDescription && (
            <p style={{ fontSize: 12, color: 'var(--ms-ink-2)', lineHeight: 1.6, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ms-surface-3)' }}>{p.propertyDescription}</p>
          )}
        </Card>
        {mix.length > 0 ? (
          <Card title="Unit mix" sub="what this building is made of" pad>
            <Bars rows={mix.map(([type, count]) => ({ l: humanize(type), pct: mixMax ? (count / mixMax) * 100 : 0, v: count }))} />
          </Card>
        ) : (
          <Card title="Unit mix" pad><div className="gx-empty">No unit mix recorded.</div></Card>
        )}
      </Cols>

      {/* Property documents (view-only). Unit floor plans live on each unit's detail page. */}
      <div style={{ marginBottom: 14 }}>
        <TableWrap toolbar={<><strong style={{ fontSize: 13 }}>Property documents</strong><Pill tone="neutral" dot={false}>{d.documents.length}</Pill></>}>
          <table className="gx-tbl">
            <thead><tr><th>Document</th><th>Status</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
            {d.documents.length === 0 ? (
              <EmptyRow cols={3} title="No documents linked to this property." text=" Unit floor plans appear on each unit's detail page." />
            ) : (
              <tbody>
                {d.documents.map((doc) => {
                  const ok = ['processed', 'complete', 'approved'].includes(String(doc.status).toLowerCase());
                  const caption = (doc.displayName ?? doc.documentKey).replace(/_/g, ' ');
                  return (
                    <tr key={doc.id}>
                      <td className="strong" style={{ textTransform: 'capitalize' }}>{caption}</td>
                      <td><Pill tone={ok ? 'primary' : 'amber'}>{humanize(String(doc.status ?? 'pending').toLowerCase())}</Pill></td>
                      <td className="act">
                        {doc.fileUrl
                          ? <Btn size="xs" onClick={() => openDocViewer({ fileUrl: doc.fileUrl as string, caption })}>View</Btn>
                          : <Pill tone="outline" dot={false}>Requested</Pill>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </TableWrap>
      </div>

      <TableWrap toolbar={<><strong style={{ fontSize: 13 }}>Units</strong><Pill tone="neutral" dot={false}>{units.length}</Pill></>}>
        <table className="gx-tbl">
          <thead><tr><th>Unit</th><th>Type</th><th>Status</th><th className="num">Rent / yr</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
          {units.length === 0 ? (
            <EmptyRow cols={5} title="No units on this property." />
          ) : (
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className="click" onClick={() => router.push(`/dashboard/admin/units/${u.id}`)}>
                  <td><span className="strong">{u.unitNumber ? `Unit ${u.unitNumber}` : `Unit #${u.id}`}</span>{u.unitName && <span className="sub">{u.unitName}</span>}</td>
                  <td>{[u.unitType ? humanize(u.unitType) : null, bedsOf(u)].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{u.availability ? <StatusTag status={u.availability} /> : '—'}</td>
                  <td className="num strong">{u.rentalPrice != null ? fmtAed(u.rentalPrice) : '—'}</td>
                  <td className="act" onClick={(e) => e.stopPropagation()}><Btn size="xs" href={`/dashboard/admin/units/${u.id}`}>Open</Btn></td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </TableWrap>
    </OsPage>
  );
}
